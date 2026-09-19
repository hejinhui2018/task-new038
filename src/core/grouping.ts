import type { AppState, Finding, FixGroup, GroupId } from './types'

/**
 * 自动归并签名：规则 × 组件 × 根因键。
 * 只有三者完全一致的命中才可能来自同一组件根因。
 */
export function autoSignature(ruleId: string, component: string, rootCauseKey: string): string {
  return `${ruleId}${component}${rootCauseKey}`
}

export function findingSignature(state: AppState, f: Finding): string {
  return autoSignature(f.ruleId, state.instances[f.instanceId].component, f.evidence.rootCauseKey)
}

/**
 * 找到一个自动归并组。稳定性规则：
 *  - 只进入 origin === 'auto' 的组（拆分/合并产生的组视为人工组，不再自动吸收新命中）
 *  - 多个候选时取 id 最小者（确定性，避免扫描顺序影响结果）
 */
export function findAutoGroup(state: AppState, sig: string): FixGroup | undefined {
  return Object.values(state.groups)
    .filter((g) => !g.archived && g.origin === 'auto' && g.autoSignature === sig)
    .sort((a, b) => (a.id < b.id ? -1 : 1))[0]
}

/**
 * 新命中归位：返回应进入的组 id；不存在则返回 null，由调用方创建新组。
 * 已存在的命中（刷新场景）永远不会被自动移动 —— 归并决策一旦做出即稳定，
 * 纠正只能通过人工拆分/合并。
 */
export function placeNewFinding(state: AppState, finding: Finding): GroupId | null {
  const sig = findingSignature(state, finding)
  return findAutoGroup(state, sig)?.id ?? null
}
