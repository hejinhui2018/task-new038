/** 纯函数 reducer：所有状态变更都走这里，便于测试与撤销重做 */
import type {
  AppState,
  ComponentInstance,
  Evidence,
  FixCandidate,
  FixGroup,
  ID,
  Page,
  RuleHit,
  Severity,
  Verification,
  Verdict,
} from "./types";
import { uid } from "./id";
import { canonicalTitle, signatureOf } from "./groups";
import { latestCandidate } from "./selectors";

export type { AppState } from "./types";

export const emptyState: AppState = {
  pages: {},
  instances: {},
  hits: {},
  groups: {},
  candidates: {},
  verifications: [],
};

export type Action =
  | { type: "ADD_PAGE"; page: Omit<Page, "id"> & { id?: ID }; now: number }
  | {
      type: "ADD_INSTANCE";
      instance: Omit<ComponentInstance, "id"> & { id?: ID };
    }
  | {
      type: "ADD_HIT";
      hit: {
        id?: ID;
        instanceId: ID;
        ruleId: string;
        ruleTitle: string;
        severity: Severity;
        evidence: Omit<Evidence, "codeVersion"> & { codeVersion?: string };
      };
      now: number;
    }
  | {
      type: "SUBMIT_CANDIDATE";
      groupId: ID;
      title: string;
      description?: string;
      now: number;
    }
  | {
      type: "VERIFY";
      candidateId: ID;
      hitId: ID;
      verdict: Verdict;
      note?: string;
      now: number;
    }
  | { type: "SPLIT_GROUP"; groupId: ID; movingHitIds: ID[]; now: number }
  | { type: "MERGE_GROUPS"; groupIds: ID[]; now: number }
  | { type: "CHANGE_INSTANCE_VERSION"; instanceId: ID; version: string }
  | { type: "RESET"; state?: AppState };

function addHit(state: AppState, action: Extract<Action, { type: "ADD_HIT" }>): AppState {
  const instance = state.instances[action.hit.instanceId];
  if (!instance) return state;

  const hitId = action.hit.id ?? uid("hit");
  const evidence: Evidence = {
    snippet: action.hit.evidence.snippet,
    observedAt: action.hit.evidence.observedAt,
    codeVersion: action.hit.evidence.codeVersion ?? instance.version,
  };
  const hit: RuleHit = {
    id: hitId,
    instanceId: instance.id,
    ruleId: action.hit.ruleId,
    ruleTitle: action.hit.ruleTitle,
    severity: action.hit.severity,
    evidence,
    foundAt: action.now,
  };

  const sig = signatureOf(hit.ruleId, instance.componentName);
  // 只自动并入“自动归并组”；手工组（拆分/跨键合并产物）不吸纳新命中
  let existing: FixGroup | undefined;
  for (const g of Object.values(state.groups)) {
    if (g.signature === sig) {
      existing = g;
      break;
    }
  }

  const hits = { ...state.hits, [hitId]: hit };
  let groups = state.groups;
  if (existing) {
    if (existing.hitIds.includes(hitId)) return state;
    groups = {
      ...groups,
      [existing.id]: { ...existing, hitIds: [...existing.hitIds, hitId] },
    };
  } else {
    const group: FixGroup = {
      id: uid("grp"),
      title: canonicalTitle(instance.componentName, hit.ruleTitle),
      ruleId: hit.ruleId,
      componentName: instance.componentName,
      signature: sig,
      hitIds: [hitId],
      createdAt: action.now,
    };
    groups = { ...groups, [group.id]: group };
  }
  return { ...state, hits, groups };
}

function splitGroup(
  state: AppState,
  action: Extract<Action, { type: "SPLIT_GROUP" }>
): AppState {
  const source = state.groups[action.groupId];
  if (!source) return state;
  const moving = new Set(action.movingHitIds);
  const movingInGroup = source.hitIds.filter((id) => moving.has(id));
  const remaining = source.hitIds.filter((id) => !moving.has(id));
  // 不允许把组拆空
  if (movingInGroup.length === 0 || remaining.length === 0) return state;

  const newGroup: FixGroup = {
    id: uid("grp"),
    title: `${source.title}（拆分组）`,
    ruleId: source.ruleId,
    componentName: source.componentName,
    signature: null,
    hitIds: movingInGroup,
    createdAt: action.now,
    manual: true,
  };
  return {
    ...state,
    groups: {
      ...state.groups,
      [source.id]: { ...source, hitIds: remaining },
      [newGroup.id]: newGroup,
    },
  };
}

function mergeGroups(
  state: AppState,
  action: Extract<Action, { type: "MERGE_GROUPS" }>
): AppState {
  const ids = action.groupIds;
  if (ids.length < 2) return state;
  const sources = ids.map((id) => state.groups[id]);
  if (sources.some((g) => !g)) return state;

  const mergedId = uid("grp");
  // 命中按“第一组顺序优先、后续追加新项”合并，稳定去重保序
  const seen = new Set<ID>();
  const hitIds: ID[] = [];
  for (const g of sources) {
    for (const hid of g.hitIds) {
      if (!seen.has(hid)) {
        seen.add(hid);
        hitIds.push(hid);
      }
    }
  }

  // 所有源组 signature 相同且非空时保留自动归并键，否则成为手工组
  const sigs = new Set(sources.map((g) => g.signature));
  const keepSignature = sigs.size === 1 ? [...sigs][0] : null;

  const base = sources[0];
  const merged: FixGroup = {
    id: mergedId,
    title: base.title,
    ruleId: base.ruleId,
    componentName: base.componentName,
    signature: keepSignature,
    hitIds,
    createdAt: action.now,
    manual: keepSignature === null,
  };

  // 候选处理：保留最近提交的候选并改挂到新组；旧候选留在原地备查、不再驱动判定
  const candidates = Object.values(state.candidates)
    .filter((c) => ids.includes(c.groupId))
    .sort((a, b) => b.createdAt - a.createdAt);
  let candidateMap = { ...state.candidates };
  if (candidates.length > 0) {
    const keep: FixCandidate = { ...candidates[0], groupId: mergedId };
    candidateMap[keep.id] = keep;
  }

  const groups = { ...state.groups };
  for (const id of ids) delete groups[id];
  groups[mergedId] = merged;

  return { ...state, groups, candidates: candidateMap };
}

function verify(
  state: AppState,
  action: Extract<Action, { type: "VERIFY" }>
): AppState {
  const candidate = state.candidates[action.candidateId];
  const hit = state.hits[action.hitId];
  if (!candidate || !hit) return state;
  const instance = state.instances[hit.instanceId];

  // 复验快照：记录当时实例版本，之后换版即可判定过期
  const record: Verification = {
    id: uid("ver"),
    candidateId: candidate.id,
    hitId: hit.id,
    pageId: instance.pageId,
    verdict: action.verdict,
    instanceVersion: instance.version,
    checkedAt: action.now,
    note: action.note,
  };
  // 重复验证：追加历史，不覆盖；判定始终取最新一条
  return { ...state, verifications: [...state.verifications, record] };
}

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "ADD_PAGE": {
      const id = action.page.id ?? uid("page");
      if (state.pages[id]) return state;
      return {
        ...state,
        pages: {
          ...state.pages,
          [id]: { id, name: action.page.name, url: action.page.url },
        },
      };
    }
    case "ADD_INSTANCE": {
      const id = action.instance.id ?? uid("inst");
      if (state.instances[id]) return state;
      const inst: ComponentInstance = {
        id,
        pageId: action.instance.pageId,
        componentName: action.instance.componentName,
        selector: action.instance.selector,
        version: action.instance.version,
      };
      return { ...state, instances: { ...state.instances, [id]: inst } };
    }
    case "ADD_HIT":
      return addHit(state, action);
    case "SUBMIT_CANDIDATE": {
      const group = state.groups[action.groupId];
      if (!group || !action.title.trim()) return state;
      const candidate: FixCandidate = {
        id: uid("fix"),
        groupId: group.id,
        title: action.title.trim(),
        description: action.description?.trim() || undefined,
        createdAt: action.now,
      };
      return {
        ...state,
        candidates: { ...state.candidates, [candidate.id]: candidate },
      };
    }
    case "VERIFY":
      return verify(state, action);
    case "SPLIT_GROUP":
      return splitGroup(state, action);
    case "MERGE_GROUPS":
      return mergeGroups(state, action);
    case "CHANGE_INSTANCE_VERSION": {
      const inst = state.instances[action.instanceId];
      if (!inst || inst.version === action.version) return state;
      return {
        ...state,
        instances: {
          ...state.instances,
          [inst.id]: { ...inst, version: action.version },
        },
      };
    }
    case "RESET":
      return action.state ? cloneState(action.state) : emptyState;
    default:
      return state;
  }
}

/** 深拷贝用于导入/复位外部快照，切断引用共享 */
export function cloneState(s: AppState): AppState {
  return JSON.parse(JSON.stringify(s)) as AppState;
}

export function describeLatestCandidate(state: AppState, groupId: ID) {
  return latestCandidate(state, groupId);
}
