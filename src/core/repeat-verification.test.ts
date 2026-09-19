import { describe, expect, it } from "vitest";
import { buildSeedState } from "./seed";
import { reducer } from "./reducer";
import { signatureOf } from "./groups";
import {
  groupStatus,
  hitStatus,
  hitViews,
  latestCandidate,
  latestVerification,
} from "./selectors";
import type { AppState } from "./types";
import { commit, initHistory, redo, undo } from "./history";

const NOW = 1_700_000_000_000;

function setup() {
  let state = buildSeedState(NOW);
  const sig = signatureOf("button-name", "Button");
  const groupId = Object.values(state.groups).find((g) => g.signature === sig)!.id;
  state = reducer(state, {
    type: "SUBMIT_CANDIDATE",
    groupId,
    title: "aria-label 回退",
    now: NOW + 5000,
  });
  return { state, groupId, candidateId: latestCandidate(state, groupId)!.id };
}

describe("重复验证：历史追加、最新为准", () => {
  it("同一页面通过→失败→再通过：状态随最新复验变化，历史完整保留", () => {
    let { state, candidateId } = setup();
    const hitId = "hit_btn_page_home";

    state = reducer(state, { type: "VERIFY", candidateId, hitId, verdict: "pass", now: NOW + 5100 });
    // pass
    let candidate = state.candidates[candidateId]!;
    expect(hitStatus(state, hitId, candidate)).toBe("passed");

    state = reducer(state, { type: "VERIFY", candidateId, hitId, verdict: "fail", now: NOW + 5200 });
    candidate = state.candidates[candidateId];
    expect(hitStatus(state, hitId, candidate)).toBe("regressed");

    state = reducer(state, { type: "VERIFY", candidateId, hitId, verdict: "pass", now: NOW + 5300 });
    expect(hitStatus(state, hitId, state.candidates[candidateId])).toBe("passed");

    const records = state.verifications.filter(
      (v) => v.candidateId === candidateId && v.hitId === hitId
    );
    expect(records.map((r) => [r.verdict, r.checkedAt])).toEqual([
      ["pass", NOW + 5100],
      ["fail", NOW + 5200],
      ["pass", NOW + 5300],
    ]);
    expect(latestVerification(state, candidateId, hitId)?.verdict).toBe("pass");
  });

  it("重复提交相同结果不会覆盖或丢失任何一次复验快照", () => {
    let { state, candidateId } = setup();
    for (let i = 0; i < 3; i++) {
      state = reducer(state, {
        type: "VERIFY",
        candidateId,
        hitId: "hit_btn_page_search",
        verdict: "pass",
        now: NOW + 6000 + i,
        note: i === 1 ? "二次确认" : undefined,
      });
    }
    const records = state.verifications.filter(
      (v) => v.hitId === "hit_btn_page_search"
    );
    expect(records).toHaveLength(3);
    expect(records[1].note).toBe("二次确认");
    expect(hitStatus(state, "hit_btn_page_search", state.candidates[candidateId])).toBe(
      "passed"
    );
  });

  it("旧版本通过 → 换版过期 → 新版本再通过：以新版本最新快照为准", () => {
    let { state, candidateId } = setup();
    state = reducer(state, {
      type: "VERIFY",
      candidateId,
      hitId: "hit_btn_page_cart",
      verdict: "pass",
      now: NOW + 5100,
    });
    state = reducer(state, {
      type: "CHANGE_INSTANCE_VERSION",
      instanceId: "inst_cart_btn",
      version: "button@2.2.0",
    });
    expect(
      hitStatus(state, "hit_btn_page_cart", state.candidates[candidateId])
    ).toBe("stale");

    state = reducer(state, {
      type: "VERIFY",
      candidateId,
      hitId: "hit_btn_page_cart",
      verdict: "pass",
      now: NOW + 7000,
    });
    expect(
      hitStatus(state, "hit_btn_page_cart", state.candidates[candidateId])
    ).toBe("passed");
    // 旧的过期快照仍在历史里
    const records = state.verifications.filter(
      (v) => v.hitId === "hit_btn_page_cart"
    );
    expect(records.map((r) => r.instanceVersion)).toEqual([
      "button@2.1.0",
      "button@2.2.0",
    ]);
  });

  it("一个页面反复回归时组始终保持打开", () => {
    let { state, groupId, candidateId } = setup();
    const hitIds = [
      "hit_btn_page_home",
      "hit_btn_page_search",
      "hit_btn_page_cart",
      "hit_btn_page_settings",
    ];
    const passAll = (s: AppState, at: number) =>
      hitIds.reduce(
        (acc, hitId, i) =>
          reducer(acc, {
            type: "VERIFY",
            candidateId,
            hitId,
            verdict: "pass",
            now: at + i,
          }),
        s
      );

    state = passAll(state, NOW + 5100);
    expect(groupStatus(state, state.groups[groupId])).toBe("resolved");

    state = reducer(state, {
      type: "VERIFY",
      candidateId,
      hitId: "hit_btn_page_home",
      verdict: "fail",
      now: NOW + 6000,
    });
    expect(groupStatus(state, state.groups[groupId])).toBe("regressed");

    state = reducer(state, {
      type: "VERIFY",
      candidateId,
      hitId: "hit_btn_page_home",
      verdict: "pass",
      now: NOW + 6100,
    });
    expect(groupStatus(state, state.groups[groupId])).toBe("resolved");
    expect(hitViews(state, state.groups[groupId])).toHaveLength(4);
  });
});

describe("撤销重做", () => {
  it("复验、拆分、换版均可撤销重做且状态一致", () => {
    const { state: initial, candidateId } = setup();
    let h = initHistory(initial);

    const passed = reducer(h.present, {
      type: "VERIFY",
      candidateId,
      hitId: "hit_btn_page_home",
      verdict: "pass",
      now: NOW + 5100,
    });
    h = commit(h, passed);
    const split = reducer(h.present, {
      type: "SPLIT_GROUP",
      groupId: Object.keys(passed.groups)[0],
      movingHitIds: ["hit_btn_page_home"],
      now: NOW + 5200,
    });
    // 找到 button 组（含 cart 命中）
    const btnGroup = Object.values(split.groups).find((g) =>
      g.hitIds.includes("hit_btn_page_cart")
    )!;
    const splitState = reducer(h.present, {
      type: "SPLIT_GROUP",
      groupId: btnGroup.id,
      movingHitIds: ["hit_btn_page_cart"],
      now: NOW + 5200,
    });
    h = commit(h, splitState);
    const bumped = reducer(h.present, {
      type: "CHANGE_INSTANCE_VERSION",
      instanceId: "inst_home_btn",
      version: "button@9.0.0",
    });
    h = commit(h, bumped);

    expect(h.present.instances.inst_home_btn.version).toBe("button@9.0.0");
    h = undo(h);
    expect(h.present.instances.inst_home_btn.version).toBe("button@2.1.0");
    h = undo(h);
    expect(
      Object.values(h.present.groups).find((g) => g.hitIds.includes("hit_btn_page_cart"))
        ?.hitIds
    ).toContain("hit_btn_page_home"); // 撤销拆分后两命中同组
    h = redo(h);
    expect(
      Object.values(h.present.groups).filter((g) =>
        g.hitIds.some((id) => id.startsWith("hit_btn_"))
      )
    ).toHaveLength(2);
    h = redo(h);
    expect(h.present.instances.inst_home_btn.version).toBe("button@9.0.0");
  });
});
