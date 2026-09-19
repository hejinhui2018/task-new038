/** 派生状态：命中状态、组状态、影响范围解释 */
import type {
  AppState,
  FixCandidate,
  FixGroup,
  GroupStatus,
  HitStatus,
  ID,
  ImpactNote,
  RuleHit,
  Verification,
} from "./types";

export function hitInstance(state: AppState, hitId: ID) {
  const hit = state.hits[hitId];
  return hit ? state.instances[hit.instanceId] : undefined;
}

export function hitPage(state: AppState, hitId: ID) {
  const inst = hitInstance(state, hitId);
  return inst ? state.pages[inst.pageId] : undefined;
}

/** 组的最新修复候选（一次修复尝试；失败后可再提交新候选） */
export function latestCandidate(
  state: AppState,
  groupId: ID
): FixCandidate | undefined {
  let latest: FixCandidate | undefined;
  for (const c of Object.values(state.candidates)) {
    if (c.groupId !== groupId) continue;
    if (!latest || c.createdAt > latest.createdAt) latest = c;
  }
  return latest;
}

/** 某候选对某条命中的最新一次复验（重复验证时只看最新结果） */
export function latestVerification(
  state: AppState,
  candidateId: ID,
  hitId: ID
): Verification | undefined {
  let latest: Verification | undefined;
  for (const v of state.verifications) {
    if (v.candidateId !== candidateId || v.hitId !== hitId) continue;
    if (!latest || v.checkedAt > latest.checkedAt) latest = v;
  }
  return latest;
}

/**
 * 该命中是否曾在当前候选下通过过 —— 用于区分“从未通过的失败”与“通过后又失败的回归”。
 */
function hasPassedBefore(state: AppState, candidateId: ID, hitId: ID): boolean {
  return state.verifications.some(
    (v) => v.candidateId === candidateId && v.hitId === hitId && v.verdict === "pass"
  );
}

/** 单条命中在给定候选下的状态 */
export function hitStatus(
  state: AppState,
  hitId: ID,
  candidate?: FixCandidate
): HitStatus {
  if (!candidate) return "open";
  const v = latestVerification(state, candidate.id, hitId);
  if (!v) return "pending";
  if (v.verdict === "fail") {
    return hasPassedBefore(state, candidate.id, hitId) ? "regressed" : "failed";
  }
  // pass：证据/复验是否随实例换版而过期
  const inst = hitInstance(state, hitId);
  if (inst && v.instanceVersion !== inst.version) return "stale";
  return "passed";
}

export interface HitView {
  hit: RuleHit;
  status: HitStatus;
  latestVerification?: Verification;
}

export function hitViews(state: AppState, group: FixGroup): HitView[] {
  const candidate = latestCandidate(state, group.id);
  return group.hitIds.map((hitId) => {
    const hit = state.hits[hitId];
    return {
      hit,
      status: hitStatus(state, hitId, candidate),
      latestVerification: candidate
        ? latestVerification(state, candidate.id, hitId)
        : undefined,
    };
  });
}

export const GROUP_STATUS_ORDER: GroupStatus[] = [
  "open",
  "pending",
  "resolved",
  "partial",
  "failed",
  "stale",
  "regressed",
];

/** 组状态由各页面命中的状态聚合 —— 部分通过时未通过项不会被关闭 */
export function groupStatus(state: AppState, group: FixGroup): GroupStatus {
  const candidate = latestCandidate(state, group.id);
  if (!candidate) return "open";
  const statuses = group.hitIds.map((id) => hitStatus(state, id, candidate));

  if (statuses.length === 0) return "open";
  if (statuses.every((s) => s === "passed")) return "resolved";

  if (statuses.some((s) => s === "regressed")) return "regressed";

  const hasFail = statuses.some((s) => s === "failed");
  const hasStale = statuses.some((s) => s === "stale");
  const hasPending = statuses.some((s) => s === "pending");
  const hasPass = statuses.some((s) => s === "passed");

  // 没有未决项、没有新鲜失败，剩下的通过都过期了
  if (!hasFail && !hasPending && hasStale && !hasPass) return "stale";
  // 只要有一部分页面通过，就属于部分通过（未通过/待验/过期/回归项保持打开）
  if (hasPass) return "partial";
  if (hasFail) return "failed";
  return "pending";
}

export function countByStatus(views: HitView[]) {
  const counts: Record<HitStatus, number> = {
    open: 0,
    pending: 0,
    passed: 0,
    failed: 0,
    stale: 0,
    regressed: 0,
  };
  for (const v of views) counts[v.status] += 1;
  return counts;
}

/** 受影响页面清单（去重保序） */
export function affectedPages(state: AppState, hitIds: ID[]) {
  const seen = new Set<ID>();
  const pages = [];
  for (const hitId of hitIds) {
    const page = hitPage(state, hitId);
    if (page && !seen.has(page.id)) {
      seen.add(page.id);
      pages.push(page);
    }
  }
  return pages;
}

function pageNames(state: AppState, hitIds: ID[]): string[] {
  return affectedPages(state, hitIds).map((p) => p.name);
}

/** 归并错误（错误合并）：解释拆分影响范围 */
export function explainSplit(
  state: AppState,
  sourceGroupId: ID,
  movingHitIds: ID[]
): ImpactNote {
  const group = state.groups[sourceGroupId];
  const candidate = group ? latestCandidate(state, group.id) : undefined;
  const moving = new Set(movingHitIds);
  const remaining = group ? group.hitIds.filter((id) => !moving.has(id)) : [];
  const lines = [
    `拆出 ${movingHitIds.length} 条命中，涉及页面：${
      pageNames(state, movingHitIds).join("、") || "—"
    }。`,
    `原组保留 ${remaining.length} 条命中，涉及页面：${
      pageNames(state, remaining).join("、") || "—"
    }。`,
  ];
  if (candidate) {
    lines.push(
      `当前候选「${candidate.title}」及其全部复验记录留在原组；拆出的命中成为独立的新组，需要重新提交修复候选并逐页复验。`
    );
  }
  lines.push("两个新组互不影响：任一组关闭都不会带走另一组的页面证据。");
  return { tone: "warn", title: "拆分影响范围", lines };
}

/** 归并错误（漏归并）：解释合并影响范围 */
export function explainMerge(
  state: AppState,
  groupIds: ID[]
): ImpactNote {
  const groups = groupIds.map((id) => state.groups[id]).filter(Boolean);
  const allHits = groups.flatMap((g) => g.hitIds);
  const candidates = groups
    .map((g) => latestCandidate(state, g.id))
    .filter(Boolean) as FixCandidate[];
  const lines = [
    `合并后共 ${allHits.length} 条命中，涉及页面：${
      pageNames(state, allHits).join("、") || "—"
    }。`,
  ];
  if (candidates.length > 1) {
    lines.push(
      `⚠ ${candidates.length} 个组各自有修复候选（${candidates
        .map((c) => `「${c.title}」`)
        .join("、")}）。合并只保留最近提交的候选，旧候选的复验记录不再用于自动判定，但历史记录保留备查。`
    );
  } else if (candidates.length === 1) {
    lines.push(`候选「${candidates[0].title}」继续有效，未复验的页面需要补验。`);
  }
  const autoGroups = groups.filter((g) => g.signature);
  if (autoGroups.length >= 1 && new Set(groups.map((g) => g.signature)).size > 1) {
    lines.push(
      "这些组的自动归并键不同；合并后成为手工组，不再按组件根因自动吸纳新扫描的命中，需要手动跟进。"
    );
  }
  return { tone: "info", title: "合并影响范围", lines };
}

/** 实例换版：解释证据/通过记录过期范围 */
export function explainVersionChange(
  state: AppState,
  instanceId: ID,
  nextVersion: string
): ImpactNote {
  const inst = state.instances[instanceId];
  const hits = Object.values(state.hits).filter((h) => h.instanceId === instanceId);
  const lines: string[] = [];
  if (!inst) return { tone: "warn", title: "版本变化", lines: ["实例不存在。"] };

  lines.push(
    `实例 ${inst.componentName}（${inst.selector}）：${inst.version} → ${nextVersion}。`
  );
  if (hits.length === 0) {
    lines.push("该实例当前没有规则命中，无证据需要重新采集。");
    return { tone: "info", title: "版本变化影响范围", lines };
  }

  let stalePass = 0;
  const affectedGroups = new Set<ID>();
  for (const hit of hits) {
    for (const g of Object.values(state.groups)) {
      if (!g.hitIds.includes(hit.id)) continue;
      affectedGroups.add(g.id);
      const candidate = latestCandidate(state, g.id);
      if (!candidate) continue;
      const v = latestVerification(state, candidate.id, hit.id);
      if (v?.verdict === "pass" && v.instanceVersion === inst.version) {
        stalePass += 1;
      }
    }
  }
  lines.push(
    `该实例上的 ${hits.length} 条扫描证据的采集版本停留在旧版本，需要重新扫描确认。`
  );
  if (stalePass > 0) {
    lines.push(
      `其中 ${stalePass} 条曾在旧版本复验通过，换版后标记为“过期”，必须在 ${nextVersion} 上重新验证通过才能关闭，未复验前不会自动关闭。`
    );
  } else {
    lines.push("没有需要失效的通过记录；失败/待验状态保持不变。");
  }
  if (affectedGroups.size > 0) {
    lines.push(
      `波及 ${affectedGroups.size} 个修复组，组级状态会在下次打开时自动重算。`
    );
  }
  return { tone: "warn", title: "版本变化影响范围", lines };
}

/** 一次复验后解释结果，尤其强调部分通过时不连带关闭 */
export function explainVerification(
  state: AppState,
  groupId: ID
): ImpactNote {
  const group = state.groups[groupId];
  if (!group) return { tone: "info", title: "复验", lines: [] };
  const candidate = latestCandidate(state, group.id);
  const status = groupStatus(state, group);
  const views = hitViews(state, group);
  const counts = countByStatus(views);
  const lines: string[] = [];

  if (candidate) {
    lines.push(`候选「${candidate.title}」当前判定：${statusLabel(status)}。`);
  }
  lines.push(
    `页面证据：通过 ${counts.passed}，失败 ${counts.failed}，回归 ${counts.regressed}，过期 ${counts.stale}，待验 ${counts.pending}。`
  );
  if (status === "partial") {
    const failedPages = views
      .filter((v) => v.status !== "passed")
      .map((v) => {
        const p = hitPage(state, v.hit.id);
        return p ? p.name : v.hit.id;
      });
    lines.push(
      `仅部分页面通过，未通过/待验页面（${failedPages.join(
        "、"
      )}）保持打开，修复组不会关闭。`
    );
  }
  if (status === "regressed") {
    lines.push("检测到修复回归：曾经验证通过的页面在最新复验中再次失败。");
  }
  if (status === "resolved") {
    lines.push("全部页面均在当前版本通过，修复组可关闭。");
  }
  return {
    tone:
      status === "resolved"
        ? "good"
        : status === "partial" || status === "stale"
        ? "warn"
        : status === "failed" || status === "regressed"
        ? "bad"
        : "info",
    title: "复验结果",
    lines,
  };
}

export function statusLabel(s: GroupStatus): string {
  const labels: Record<GroupStatus, string> = {
    open: "未开始",
    pending: "待复验",
    resolved: "全部通过",
    partial: "部分通过",
    failed: "有失败",
    stale: "证据过期",
    regressed: "修复回归",
  };
  return labels[s];
}

export function hitStatusLabel(s: HitStatus): string {
  const labels: Record<HitStatus, string> = {
    open: "未开始",
    pending: "待复验",
    passed: "通过",
    failed: "失败",
    stale: "过期",
    regressed: "回归",
  };
  return labels[s];
}
