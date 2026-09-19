import { describe, expect, it } from "vitest";
import { buildSeedState } from "./seed";
import { signatureOf } from "./groups";
import { reducer } from "./reducer";
import type { AppState } from "./types";

const NOW = 1_700_000_000_000;

/** 用“归并结构”而不是 ID 来比较两组状态：signature -> 每条命中所属页面/选择器集合 */
function groupingShape(state: AppState) {
  const keyOfHit = (hitId: string) => {
    const hit = state.hits[hitId];
    const inst = state.instances[hit.instanceId];
    return `${state.pages[inst.pageId].name}|${inst.selector}`;
  };
  return Object.values(state.groups)
    .map((g) => ({
      signature: g.signature,
      manual: !!g.manual,
      keys: g.hitIds.map(keyOfHit).sort(),
    }))
    .sort((a, b) => (a.signature ?? "").localeCompare(b.signature ?? ""));
}

describe("归并稳定性", () => {
  it("相同输入无论录入顺序如何，归并结果一致", () => {
    const a = buildSeedState(NOW);
    const b = buildSeedState(NOW + 99_999); // 时间戳只影响 id/createdAt，不影响归并
    expect(groupingShape(a)).toEqual(groupingShape(b));
  });

  it("4 个页面上的同规则同组件命中归为同一个修复组，且页面证据各自独立", () => {
    const state = buildSeedState(NOW);
    const sig = signatureOf("button-name", "Button");
    const group = Object.values(state.groups).find((g) => g.signature === sig)!;
    expect(group).toBeDefined();
    expect(group.hitIds).toHaveLength(4);

    const pages = group.hitIds.map((id) => {
      const hit = state.hits[id];
      return state.pages[state.instances[hit.instanceId].pageId].name;
    });
    expect(pages.sort()).toEqual(["搜索结果页", "设置页", "购物车", "首页"]);
    // 每条命中保留自己的证据与版本
    for (const hitId of group.hitIds) {
      expect(state.hits[hitId].evidence.snippet.length).toBeGreaterThan(0);
      expect(state.hits[hitId].evidence.codeVersion).toBe("button@2.1.0");
    }
  });

  it("增量录入、逆序录入与顺序录入得到相同归并结构", () => {
    // 用同一批原始事实，按两种顺序分别走 reducer
    const build = (order: number[]) => {
      let s = buildSeedState(NOW);
      const pages = ["帮助页", "账户页"];
      for (const i of order) {
        const pageId = `page_extra_${i}`;
        const instId = `inst_extra_btn_${i}`;
        s = reducer(s, {
          type: "ADD_PAGE",
          page: { id: pageId, name: pages[i], url: `/${i}` },
          now: NOW + 1000 + i,
        });
        s = reducer(s, {
          type: "ADD_INSTANCE",
          instance: {
            id: instId,
            pageId,
            componentName: "Button",
            selector: `button.x${i}`,
            version: "button@2.1.0",
          },
        });
        s = reducer(s, {
          type: "ADD_HIT",
          now: NOW + 1000 + i,
          hit: {
            id: `hit_extra_btn_${i}`,
            instanceId: instId,
            ruleId: "button-name",
            ruleTitle: "按钮缺少可访问名称",
            severity: "critical",
            evidence: { snippet: "<button></button>", observedAt: NOW + 1000 + i },
          },
        });
      }
      return s;
    };
    const forward = build([0, 1]);
    const reverse = build([1, 0]);
    expect(groupingShape(forward)).toEqual(groupingShape(reverse));

    const sig = signatureOf("button-name", "Button");
    const group = Object.values(forward.groups).find((g) => g.signature === sig)!;
    expect(group.hitIds).toHaveLength(6);
  });

  it("拆分出的手工组不再吸纳同 signature 的新命中；原自动组继续吸纳", () => {
    let state = buildSeedState(NOW);
    const sig = signatureOf("button-name", "Button");
    const autoGroup = Object.values(state.groups).find(
      (g) => g.signature === sig
    )!;
    // 把首页命中拆出去
    state = reducer(state, {
      type: "SPLIT_GROUP",
      groupId: autoGroup.id,
      movingHitIds: ["hit_btn_page_home"],
      now: NOW + 2000,
    });

    // 新页面再出现同根因命中
    state = reducer(state, {
      type: "ADD_PAGE",
      page: { id: "page_new", name: "新页面", url: "/new" },
      now: NOW + 2001,
    });
    state = reducer(state, {
      type: "ADD_INSTANCE",
      instance: {
        id: "inst_new_btn",
        pageId: "page_new",
        componentName: "Button",
        selector: "button.new",
        version: "button@2.1.0",
      },
    });
    state = reducer(state, {
      type: "ADD_HIT",
      now: NOW + 2002,
      hit: {
        id: "hit_new_btn",
        instanceId: "inst_new_btn",
        ruleId: "button-name",
        ruleTitle: "按钮缺少可访问名称",
        severity: "critical",
        evidence: { snippet: "<button></button>", observedAt: NOW + 2002 },
      },
    });

    const groups = Object.values(state.groups);
    const manualSplit = groups.find((g) => g.manual && g.hitIds.includes("hit_btn_page_home"))!;
    const stillAuto = groups.find((g) => g.signature === sig)!;
    expect(manualSplit.hitIds).toEqual(["hit_btn_page_home"]);
    expect(stillAuto.hitIds).toContain("hit_new_btn");
    expect(stillAuto.hitIds).not.toContain("hit_btn_page_home");
  });

  it("跨 signature 合并后成为手工组，后续命中各自新建自动组", () => {
    let state = buildSeedState(NOW);
    const gButton = Object.values(state.groups).find(
      (g) => g.signature === signatureOf("button-name", "Button")
    )!;
    const gLink = Object.values(state.groups).find(
      (g) => g.signature === signatureOf("link-name", "Link")
    )!;
    state = reducer(state, {
      type: "MERGE_GROUPS",
      groupIds: [gButton.id, gLink.id],
      now: NOW + 3000,
    });
    const merged = Object.values(state.groups)[0];
    expect(merged.manual).toBe(true);
    expect(merged.signature).toBeNull();
    expect(merged.hitIds).toHaveLength(6);

    // 再来一条 Button 命中：不会进手工组，而是新建自动组
    state = reducer(state, {
      type: "ADD_PAGE",
      page: { id: "page_late", name: "迟到页", url: "/late" },
      now: NOW + 3001,
    });
    state = reducer(state, {
      type: "ADD_INSTANCE",
      instance: {
        id: "inst_late_btn",
        pageId: "page_late",
        componentName: "Button",
        selector: "button.late",
        version: "button@2.2.0",
      },
    });
    state = reducer(state, {
      type: "ADD_HIT",
      now: NOW + 3002,
      hit: {
        id: "hit_late_btn",
        instanceId: "inst_late_btn",
        ruleId: "button-name",
        ruleTitle: "按钮缺少可访问名称",
        severity: "critical",
        evidence: { snippet: "<button></button>", observedAt: NOW + 3002 },
      },
    });
    const groups = Object.values(state.groups);
    expect(groups).toHaveLength(2);
    const fresh = groups.find((g) => g.hitIds.includes("hit_late_btn"))!;
    expect(fresh.signature).toBe(signatureOf("button-name", "Button"));
    expect(fresh.id).not.toBe(merged.id);
  });
});
