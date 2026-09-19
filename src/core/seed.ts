/** 示例数据：4 个页面上同一 Button 组件缺少名称（同一根因）+ 另一组 Link 问题 */
import { emptyState, reducer, type Action, type AppState } from "./reducer";

export function buildSeedState(now: number): AppState {
  let state = emptyState;
  const t = (offset: number) => now + offset;
  const dispatch = (action: Action) => {
    state = reducer(state, action);
  };

  const pages = [
    { id: "page_home", name: "首页", url: "/home" },
    { id: "page_search", name: "搜索结果页", url: "/search?q=chair" },
    { id: "page_cart", name: "购物车", url: "/cart" },
    { id: "page_settings", name: "设置页", url: "/settings" },
  ];
  for (const [i, p] of pages.entries()) {
    dispatch({ type: "ADD_PAGE", page: p, now: t(i) });
  }

  const buttons = [
    { id: "inst_home_btn", pageId: "page_home", selector: "header > button.primary" },
    { id: "inst_search_btn", pageId: "page_search", selector: "div.filters > button.apply" },
    { id: "inst_cart_btn", pageId: "page_cart", selector: "div.summary > button.checkout" },
    { id: "inst_settings_btn", pageId: "page_settings", selector: "form > button.save" },
  ];
  for (const [i, b] of buttons.entries()) {
    dispatch({
      type: "ADD_INSTANCE",
      instance: { ...b, componentName: "Button", version: "button@2.1.0" },
    });
    dispatch({
      type: "ADD_HIT",
      now: t(100 + i),
      hit: {
        id: `hit_btn_${b.pageId}`,
        instanceId: b.id,
        ruleId: "button-name",
        ruleTitle: "按钮缺少可访问名称",
        severity: "critical",
        evidence: {
          snippet: `<button class="primary"><svg .../></button> <!-- 无文本/aria-label -->`,
          observedAt: t(100 + i),
        },
      },
    });
  }

  // 第二组根因：Link 链接文本为空，出现在两个页面
  const links = [
    { id: "inst_home_link", pageId: "page_home", selector: "nav > a.logo" },
    { id: "inst_search_link", pageId: "page_search", selector: "ul.results a.thumb" },
  ];
  for (const [i, l] of links.entries()) {
    dispatch({
      type: "ADD_INSTANCE",
      instance: { ...l, componentName: "Link", version: "link@1.4.2" },
    });
    dispatch({
      type: "ADD_HIT",
      now: t(200 + i),
      hit: {
        id: `hit_link_${l.pageId}`,
        instanceId: l.id,
        ruleId: "link-name",
        ruleTitle: "链接缺少可识别文本",
        severity: "serious",
        evidence: {
          snippet: `<a href="/x"><img src="banner.png"></a> <!-- 图片无 alt -->`,
          observedAt: t(200 + i),
        },
      },
    });
  }

  return state;
}
