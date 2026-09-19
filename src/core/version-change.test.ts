import { describe, expect, it } from "vitest";
import { buildSeedState } from "./seed";
import { reducer } from "./reducer";
import { signatureOf } from "./groups";
import {
  explainVersionChange,
  groupStatus,
  hitStatus,
  hitViews,
  latestCandidate,
} from "./selectors";
import type { AppState } from "./types";

const NOW = 1_700_000_000_000;

function buttonGroupId(state: AppState): string {
  const sig = signatureOf("button-name", "Button");
  return Object.values(state.groups).find((g) => g.signature === sig)!.id;
}

function passAll(state: AppState, candidateId: string, startAt: number): AppState {
  const hitIds = [
    "hit_btn_page_home",
    "hit_btn_page_search",
    "hit_btn_page_cart",
    "hit_btn_page_settings",
  ];
  let next = state;
  hitIds.forEach((hitId, i) => {
    next = reducer(next, {
      type: "VERIFY",
      candidateId,
      hitId,
      verdict: "pass",
      now: startAt + i,
    });
  });
  return next;
}

describe("版本变化：证据过期与换版影响范围", () => {
  it("全部通过后单个实例换版 → 该页面通过变过期，组不能关闭", () => {
    let state = buildSeedState(NOW);
    const groupId = buttonGroupId(state);
    state = reducer(state, {
      type: "SUBMIT_CANDIDATE",
      groupId,
      title: "aria-label 回退",
      now: NOW + 5000,
    });
    const candidateId = latestCandidate(state, groupId)!.id;
    state = passAll(state, candidateId, NOW + 5100);
    expect(groupStatus(state, state.groups[groupId])).toBe("resolved");

    state = reducer(state, {
      type: "CHANGE_INSTANCE_VERSION",
      instanceId: "inst_cart_btn",
      version: "button@2.2.0",
    });

    // 购物车页面的通过记录基于旧版本 → 过期；其余页面仍然通过
    const candidate = latestCandidate(state, groupId)!;
    expect(hitStatus(state, "hit_btn_page_cart", candidate)).toBe("stale");
    expect(hitStatus(state, "hit_btn_page_home", candidate)).toBe("passed");

    const group = state.groups[groupId];
    expect(groupStatus(state, group)).not.toBe("resolved");
    const staleViews = hitViews(state, group).filter((v) => v.status === "stale");
    expect(staleViews.map((v) => v.hit.id)).toEqual(["hit_btn_page_cart"]);
  });

  it("所有实例一起换版 → 全部通过过期，组为证据过期状态", () => {
    let state = buildSeedState(NOW);
    const groupId = buttonGroupId(state);
    state = reducer(state, {
      type: "SUBMIT_CANDIDATE",
      groupId,
      title: "aria-label 回退",
      now: NOW + 5000,
    });
    state = passAll(state, latestCandidate(state, groupId)!.id, NOW + 5100);

    for (const id of [
      "inst_home_btn",
      "inst_search_btn",
      "inst_cart_btn",
      "inst_settings_btn",
    ]) {
      state = reducer(state, {
        type: "CHANGE_INSTANCE_VERSION",
        instanceId: id,
        version: "button@3.0.0",
      });
    }
    expect(groupStatus(state, state.groups[groupId])).toBe("stale");
  });

  it("在新版本上复验通过 → 过期解除，组重新可关闭", () => {
    let state = buildSeedState(NOW);
    const groupId = buttonGroupId(state);
    state = reducer(state, {
      type: "SUBMIT_CANDIDATE",
      groupId,
      title: "aria-label 回退",
      now: NOW + 5000,
    });
    const candidateId = latestCandidate(state, groupId)!.id;
    state = passAll(state, candidateId, NOW + 5100);
    state = reducer(state, {
      type: "CHANGE_INSTANCE_VERSION",
      instanceId: "inst_cart_btn",
      version: "button@2.2.0",
    });
    state = reducer(state, {
      type: "VERIFY",
      candidateId,
      hitId: "hit_btn_page_cart",
      verdict: "pass",
      now: NOW + 6000,
    });
    const group = state.groups[groupId];
    expect(groupStatus(state, group)).toBe("resolved");
  });

  it("换版前未通过/待验的记录不因换版被误判为通过", () => {
    let state = buildSeedState(NOW);
    const groupId = buttonGroupId(state);
    state = reducer(state, {
      type: "SUBMIT_CANDIDATE",
      groupId,
      title: "aria-label 回退",
      now: NOW + 5000,
    });
    const candidateId = latestCandidate(state, groupId)!.id;
    state = reducer(state, {
      type: "VERIFY",
      candidateId,
      hitId: "hit_btn_page_cart",
      verdict: "fail",
      now: NOW + 5100,
    });
    state = reducer(state, {
      type: "CHANGE_INSTANCE_VERSION",
      instanceId: "inst_cart_btn",
      version: "button@2.2.0",
    });
    const candidate = latestCandidate(state, groupId)!;
    // 最新记录仍是失败，且之前没通过过 → failed，而不是 stale
    expect(hitStatus(state, "hit_btn_page_cart", candidate)).toBe("failed");
  });

  it("explainVersionChange 准确报告波及的通过数与修复组数", () => {
    let state = buildSeedState(NOW);
    const groupId = buttonGroupId(state);
    state = reducer(state, {
      type: "SUBMIT_CANDIDATE",
      groupId,
      title: "aria-label 回退",
      now: NOW + 5000,
    });
    state = passAll(state, latestCandidate(state, groupId)!.id, NOW + 5100);

    const note = explainVersionChange(state, "inst_home_btn", "button@9.9.9");
    expect(note.lines.join("\n")).toContain("1 条曾在旧版本复验通过");
    expect(note.lines.join("\n")).toContain("button@2.1.0 → button@9.9.9");
    expect(note.tone).toBe("warn");

    // 未验证过的实例：没有通过记录失效
    const fresh = explainVersionChange(buildSeedState(NOW), "inst_search_btn", "x@2");
    expect(fresh.lines.join("\n")).toContain("没有需要失效的通过记录");
  });

  it("扫描证据保留采集时版本快照，与实例当前版本可对照", () => {
    const state0 = buildSeedState(NOW);
    const state = reducer(state0, {
      type: "CHANGE_INSTANCE_VERSION",
      instanceId: "inst_home_btn",
      version: "button@2.2.0",
    });
    const hit = state.hits.hit_btn_page_home;
    expect(hit.evidence.codeVersion).toBe("button@2.1.0");
    expect(state.instances.inst_home_btn.version).toBe("button@2.2.0");
  });
});
