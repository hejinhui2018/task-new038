import { describe, expect, it } from "vitest";
import { buildSeedState } from "./seed";
import { reducer } from "./reducer";
import { signatureOf } from "./groups";
import {
  groupStatus,
  hitStatus,
  hitViews,
  latestCandidate,
  countByStatus,
} from "./selectors";
import type { AppState } from "./types";

const NOW = 1_700_000_000_000;

function buttonGroupId(state: AppState): string {
  const sig = signatureOf("button-name", "Button");
  return Object.values(state.groups).find((g) => g.signature === sig)!.id;
}

function submitFix(state: AppState, title = "给 Button 增加 aria-label 回退", now = NOW + 5000) {
  const groupId = buttonGroupId(state);
  const next = reducer(state, {
    type: "SUBMIT_CANDIDATE",
    groupId,
    title,
    now,
  });
  return { state: next, groupId, candidateId: latestCandidate(next, groupId)!.id };
}function verify(
  state: AppState,
  candidateId: string,
  hitId: string,
  verdict: "pass" | "fail",
  now: number
) {
  return reducer(state, {
    type: "VERIFY",
    candidateId,
    hitId,
    verdict,
    now,
  });
}

describe("部分通过：未通过页面不能跟着关闭", () => {
  it("2 通过 / 1 失败 / 1 待验 → 组为部分通过，失败和待验命中均不关闭", () => {
    let state = buildSeedState(NOW);
    const fix0 = submitFix(state);
    state = fix0.state;
    const candidateId = fix0.candidateId;

    state = verify(state, candidateId, "hit_btn_page_home", "pass", NOW + 5100);
    state = verify(state, candidateId, "hit_btn_page_search", "pass", NOW + 5101);
    state = verify(state, candidateId, "hit_btn_page_cart", "fail", NOW + 5102);
    // settings 故意不验证

    const groupId = buttonGroupId(state);
    const group = state.groups[groupId];
    expect(groupStatus(state, group)).toBe("partial");

    const views = hitViews(state, group);
    const byId = Object.fromEntries(views.map((v) => [v.hit.id, v.status]));
    expect(byId.hit_btn_page_home).toBe("passed");
    expect(byId.hit_btn_page_search).toBe("passed");
    expect(byId.hit_btn_page_cart).toBe("failed");
    expect(byId.hit_btn_page_settings).toBe("pending");

    // 关键不变量：只有全部通过才算解决；任何非 passed 项都使组保持打开
    const counts = countByStatus(views);
    expect(counts.passed).toBe(2);
    expect(views.every((v) => v.status === "passed")).toBe(false);
  });

  it("补验剩余页面全部通过后才能关闭（全部页面证据各自独立通过）", () => {
    let state = buildSeedState(NOW);
    const fix1 = submitFix(state);
    state = fix1.state;
    const candidateId = fix1.candidateId;
    const order = [
      "hit_btn_page_home",
      "hit_btn_page_search",
      "hit_btn_page_cart",
      "hit_btn_page_settings",
    ];
    order.forEach((hitId, i) => {
      state = verify(state, candidateId, hitId, "pass", NOW + 5200 + i);
      const group = state.groups[buttonGroupId(state)];
      if (i < 3) expect(groupStatus(state, group)).not.toBe("resolved");
    });
    const group = state.groups[buttonGroupId(state)];
    expect(groupStatus(state, group)).toBe("resolved");
    expect(hitViews(state, group).every((v) => v.status === "passed")).toBe(true);
  });

  it("通过后又复验失败 → 该页面为回归，组级标记回归且不关闭", () => {
    let state = buildSeedState(NOW);
    const fix2 = submitFix(state);
    state = fix2.state;
    const candidateId = fix2.candidateId;
    state = verify(state, candidateId, "hit_btn_page_home", "pass", NOW + 5300);
    state = verify(state, candidateId, "hit_btn_page_search", "pass", NOW + 5301);
    state = verify(state, candidateId, "hit_btn_page_cart", "pass", NOW + 5302);
    state = verify(state, candidateId, "hit_btn_page_settings", "pass", NOW + 5303);
    let group = state.groups[buttonGroupId(state)];
    expect(groupStatus(state, group)).toBe("resolved");

    // 发布后首页复扫再次失败：修复回归
    state = verify(state, candidateId, "hit_btn_page_home", "fail", NOW + 5400);
    group = state.groups[buttonGroupId(state)];
    expect(groupStatus(state, group)).toBe("regressed");
    const homeStatus = hitStatus(state, "hit_btn_page_home", latestCandidate(state, group.id));
    expect(homeStatus).toBe("regressed");
  });

  it("第一次修复失败后提交新候选：旧复验不带入，所有页面重新待验", () => {
    let state = buildSeedState(NOW);
    const first = submitFix(state, "尝试用 title 属性", NOW + 5000);
    state = first.state;
    state = verify(state, first.candidateId, "hit_btn_page_home", "fail", NOW + 5100);

    state = reducer(state, {
      type: "SUBMIT_CANDIDATE",
      groupId: first.groupId,
      title: "改用 aria-label",
      now: NOW + 6000,
    });
    const second = latestCandidate(state, first.groupId)!;
    expect(second.id).not.toBe(first.candidateId);

    const group = state.groups[first.groupId];
    expect(groupStatus(state, group)).toBe("pending");
    for (const view of hitViews(state, group)) {
      expect(view.status).toBe("pending");
    }
    // 旧候选的失败记录仍然保留，但不再驱动当前判定
    const oldRecords = state.verifications.filter(
      (v) => v.candidateId === first.candidateId
    );
    expect(oldRecords).toHaveLength(1);
  });

  it("拆分后两个组独立关闭：全关一组不会带走另一组的页面证据", () => {
    let state = buildSeedState(NOW);
    const fix = submitFix(state);
    state = fix.state;
    state = reducer(state, {
      type: "SPLIT_GROUP",
      groupId: fix.groupId,
      movingHitIds: ["hit_btn_page_home", "hit_btn_page_search"],
      now: NOW + 5050,
    });
    // 拆分组没有候选，保持未开始
    const groups = Object.values(state.groups).filter((g) =>
      g.hitIds.some((id) => id.startsWith("hit_btn_"))
    );
    expect(groups).toHaveLength(2);
    for (const g of groups) {
      const candidate = latestCandidate(state, g.id);
      if (!candidate) {
        expect(g.hitIds).toContain("hit_btn_page_home");
        for (const hitId of g.hitIds) {
          expect(hitStatus(state, hitId, undefined)).toBe("open");
        }
      } else {
        // 原组候选保留，其中页面仍需逐页验证，不会因为拆分组而变化
        expect(g.hitIds).toContain("hit_btn_page_cart");
        expect(groupStatus(state, g)).toBe("pending");
      }
    }
  });
});
