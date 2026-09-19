import type {
  AppState,
  CandidateId,
  Finding,
  FindingId,
  FindingStatus,
  FixCandidate,
  FixGroup,
  GroupId,
  GroupStatus,
  ScopeCount,
  Verification,
} from './types'

export function activeGroups(state: AppState): FixGroup[] {
  return Object.values(state.groups)
    .filter((g) => !g.archived)
    .sort((a, b) => (a.id < b.id ? -1 : 1))
}

export function groupMembers(state: AppState, group: FixGroup): Finding[] {
  return group.memberIds
    .map((id) => state.findings[id])
    .filter(Boolean)
    .sort((a, b) => a.id.localeCompare(b.id))
}

/** 某命中在指定候选下的最近一次验证快照 */
export function latestVerificationFor(
  state: AppState,
  findingId: FindingId,
  candidateId: CandidateId,
): Verification | undefined {
  let latest: Verification | undefined
  for (const v of state.verifications) {
    if (v.findingId === findingId && v.candidateId === candidateId) {
      if (!latest || v.at > latest.at || (v.at === latest.at && v.id > latest.id)) latest = v
    }
  }
  return latest
}

/** 该命中的全部验证历史（最新在前） */
export function verificationHistory(state: AppState, findingId: FindingId): Verification[] {
  return state.verifications
    .filter((v) => v.findingId === findingId)
    .sort((a, b) => b.at - a.at || b.id.localeCompare(a.id))
}

export type SnapshotValidity = 'current' | 'stale-evidence' | 'stale-version' | 'superseded'

/** 验证快照在当前世界中的有效性 */
export function snapshotValidity(
  state: AppState,
  v: Verification,
  group?: FixGroup,
): SnapshotValidity {
  if (!group) group = state.groups[v.groupId]
  if (!group || group.activeCandidateId !== v.candidateId) return 'superseded'
  const finding = state.findings[v.findingId]
  if (!finding) return 'stale-evidence'
  if (v.scanSeq !== finding.scanSeq || v.evidenceHash !== finding.evidence.hash) {
    return 'stale-evidence'
  }
  const instance = state.instances[finding.instanceId]
  if (instance && v.instanceVersion !== instance.version) return 'stale-version'
  return 'current'
}

export interface FindingView {
  finding: Finding
  groupId: GroupId | undefined
  status: FindingStatus
  latest: Verification | undefined
  latestValid: boolean
  staleReasons: string[]
}

/**
 * 逐页证据状态（部分通过的核心：状态只由“当前候选 + 当前证据现场”下
 * 该命中自己的最近一次验证决定，不允许被同组其他页面连带关闭）
 */
export function viewFinding(state: AppState, finding: Finding): FindingView {
  const groupId =
    Object.values(state.groups).find((g) => g.memberIds.includes(finding.id))?.id ?? undefined
  const group = groupId ? state.groups[groupId] : undefined
  const candidateId = group?.activeCandidateId

  let status: FindingStatus = 'open'
  let latest: Verification | undefined
  const staleReasons: string[] = []
  let latestValid = false

  if (candidateId) {
    latest = latestVerificationFor(state, finding.id, candidateId)
    if (latest) {
      const instance = state.instances[finding.instanceId]
      if (latest.scanSeq !== finding.scanSeq || latest.evidenceHash !== finding.evidence.hash) {
        status = 'stale'
        staleReasons.push('页面证据已刷新（扫描轮次/指纹变化），验证快照过期')
      } else if (instance && latest.instanceVersion !== instance.version) {
        status = 'stale'
        staleReasons.push(`实例已换版（${latest.instanceVersion} → ${instance.version}），验证快照过期`)
      } else {
        latestValid = true
        status = latest.result === 'pass' ? 'verified' : 'failed'
      }
    }
  }

  return { finding, groupId, status, latest, latestValid, staleReasons }
}

export interface GroupView {
  group: FixGroup
  candidate: FixCandidate | undefined
  findings: FindingView[]
  pages: { pageId: string; name: string }[]
  counts: ScopeCount
  status: GroupStatus
}

export function scopeCounts(views: FindingView[]): ScopeCount {
  const counts: ScopeCount = { total: views.length, verified: 0, failed: 0, stale: 0, open: 0 }
  for (const v of views) counts[v.status] += 1
  return counts
}

/**
 * 修复组状态：
 *  - open      尚无候选
 *  - fixing    有候选，还没有任何页面在当前现场通过
 *  - partial   部分页面通过 —— 未通过/过期项保持开放，组不能关闭
 *  - resolved  全部页面证据均在当前现场验证通过
 */
export function viewGroup(state: AppState, group: FixGroup): GroupView {
  const findings = groupMembers(state, group).map((f) => viewFinding(state, f))
  const counts = scopeCounts(findings)
  const candidate = group.activeCandidateId
    ? state.candidates[group.activeCandidateId]
    : undefined

  let status: GroupStatus = 'open'
  if (candidate) {
    if (counts.verified === counts.total && counts.total > 0) status = 'resolved'
    else if (counts.verified > 0) status = 'partial'
    else status = 'fixing'
  }

  const pages = [
    ...new Map(
      findings.map((v) => [v.finding.pageId, state.pages[v.finding.pageId]?.name ?? v.finding.pageId]),
    ).entries(),
  ].map(([pageId, name]) => ({ pageId, name }))

  return { group, candidate, findings, pages, counts, status }
}

export function allGroupViews(state: AppState): GroupView[] {
  return activeGroups(state).map((g) => viewGroup(state, g))
}

/** 组是否允许关闭：仅当全部页面证据当前有效且通过 */
export function canCloseGroup(state: AppState, groupId: GroupId): boolean {
  const group = state.groups[groupId]
  if (!group || group.archived || !group.activeCandidateId) return false
  return viewGroup(state, group).status === 'resolved'
}
