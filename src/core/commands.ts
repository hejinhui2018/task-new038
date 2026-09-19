import { evidenceFingerprint } from './hash'
import { autoSignature, findAutoGroup } from './grouping'
import type {
  AppState,
  CandidateId,
  Evidence,
  Finding,
  FindingId,
  FixCandidate,
  GroupId,
  ImpactEntry,
  ImpactKind,
  InstanceId,
  PageId,
  VerifyResult,
  Verification,
} from './types'

export function createInitialState(): AppState {
  return {
    seq: 0,
    scanSeq: 0,
    pages: {},
    instances: {},
    findings: {},
    groups: {},
    candidates: {},
    verifications: [],
    impactLog: [],
  }
}

/** 深拷贝状态后在 draft 上直接修改，保证撤销栈中的历史不可变 */
export function cloneState(state: AppState): AppState {
  return structuredClone(state)
}

function nextId(state: AppState, prefix: string): string {
  state.seq += 1
  return `${prefix}${state.seq}`
}

function logImpact(
  state: AppState,
  kind: ImpactKind,
  summary: string,
  detail: string,
  scope: { groupIds?: GroupId[]; findingIds?: FindingId[]; pageIds?: PageId[] },
  now: number,
): ImpactEntry {
  const entry: ImpactEntry = {
    id: nextId(state, 'imp_'),
    kind,
    at: now,
    summary,
    detail,
    groupIds: scope.groupIds ?? [],
    findingIds: scope.findingIds ?? [],
    pageIds: scope.pageIds ?? [],
  }
  state.impactLog.push(entry)
  return entry
}

export interface PageInput {
  id?: PageId
  name: string
  url: string
}

export function addPage(state: AppState, input: PageInput): { state: AppState; pageId: PageId } {
  const draft = cloneState(state)
  let id = input.id
  if (id && draft.pages[id]) {
    draft.pages[id] = { ...draft.pages[id], name: input.name, url: input.url }
  } else {
    id = id ?? nextId(draft, 'pg_')
    draft.pages[id] = { id, name: input.name, url: input.url }
  }
  return { state: draft, pageId: id }
}

export interface InstanceInput {
  id?: InstanceId
  component: string
  label: string
  version: string
}

export function addInstance(
  state: AppState,
  input: InstanceInput,
): { state: AppState; instanceId: InstanceId } {
  const draft = cloneState(state)
  let id = input.id
  if (id && draft.instances[id]) {
    draft.instances[id] = {
      ...draft.instances[id],
      component: input.component,
      label: input.label,
      version: input.version,
    }
  } else {
    id = id ?? nextId(draft, 'inst_')
    draft.instances[id] = { id, component: input.component, label: input.label, version: input.version }
  }
  return { state: draft, instanceId: id }
}

export interface FindingInput {
  pageId: PageId
  instanceId: InstanceId
  ruleId: string
  ruleTitle: string
  codeVersion: string
  evidence: Omit<Evidence, 'hash'>
}

export interface IngestResult {
  state: AppState
  findingId: FindingId
  groupId: GroupId
  groupCreated: boolean
}

/** 录入一条规则命中，并按 ruleId|component|rootCauseKey 自动归并 */
export function ingestFinding(
  state: AppState,
  input: FindingInput,
  now: number = Date.now(),
): IngestResult {
  const draft = cloneState(state)
  if (!draft.pages[input.pageId]) throw new Error('页面不存在，无法录入命中')
  const instance = draft.instances[input.instanceId]
  if (!instance) throw new Error('组件实例不存在，无法录入命中')

  const id = nextId(draft, 'fd_')
  const finding: Finding = {
    id,
    pageId: input.pageId,
    instanceId: input.instanceId,
    ruleId: input.ruleId,
    ruleTitle: input.ruleTitle,
    codeVersion: input.codeVersion,
    evidence: { ...input.evidence, hash: evidenceFingerprint(input.evidence) },
    scanSeq: draft.scanSeq,
    createdAt: now,
  }
  draft.findings[id] = finding

  const sig = autoSignature(finding.ruleId, instance.component, finding.evidence.rootCauseKey)
  const existing = findAutoGroup(draft, sig)
  let groupId: GroupId
  let groupCreated = false

  if (existing) {
    groupId = existing.id
    existing.memberIds.push(id)
    logImpact(
      draft,
      'auto-group-created',
      `命中自动归入修复组 ${groupId}`,
      `页面 ${draft.pages[input.pageId].name} 的「${finding.ruleTitle}」与该组 ${existing.memberIds.length - 1} 条既有命中具有相同签名（规则 ${finding.ruleId} · 组件 ${instance.component} · 根因 ${finding.evidence.rootCauseKey}），判定为同一组件根因。`,
      { groupIds: [groupId], findingIds: [id], pageIds: [input.pageId] },
      now,
    )
  } else {
    groupId = nextId(draft, 'grp_')
    draft.groups[groupId] = {
      id: groupId,
      autoSignature: sig,
      origin: 'auto',
      memberIds: [id],
      activeCandidateId: null,
      archived: false,
      createdAt: now,
    }
    groupCreated = true
    logImpact(
      draft,
      'auto-group-created',
      `新建修复组 ${groupId}`,
      `规则 ${finding.ruleId} · 组件 ${instance.component} · 根因 ${finding.evidence.rootCauseKey}，首个页面证据来自「${draft.pages[input.pageId].name}」。`,
      { groupIds: [groupId], findingIds: [id], pageIds: [input.pageId] },
      now,
    )
  }

  return { state: draft, findingId: id, groupId, groupCreated }
}

export function groupOfFinding(state: AppState, findingId: FindingId): GroupId | undefined {
  return Object.values(state.groups).find((g) => g.memberIds.includes(findingId))?.id
}

function requireActiveGroup(state: AppState, groupId: GroupId) {
  const g = state.groups[groupId]
  if (!g) throw new Error('修复组不存在')
  if (g.archived) throw new Error('修复组已归档，不能继续操作')
  return g
}

export interface SplitResult {
  state: AppState
  newGroupId: GroupId
  affectedPageIds: PageId[]
}

/**
 * 拆分修复组：选中的命中移到新组。
 * 新组不携带候选与验证结论 —— 移动过去的页面证据必须重新验证。
 */
export function splitGroup(
  state: AppState,
  groupId: GroupId,
  memberIds: FindingId[],
  now: number = Date.now(),
): SplitResult {
  const draft = cloneState(state)
  const source = requireActiveGroup(draft, groupId)
  const moving = memberIds.filter((id) => source.memberIds.includes(id))
  if (moving.length === 0) throw new Error('请至少选择一条命中进行拆分')
  if (moving.length === source.memberIds.length) throw new Error('不能把整组拆空，请保留至少一条命中')

  const newGroupId = nextId(draft, 'grp_')
  const sigs = new Set(
    moving.map((id) => {
      const f = draft.findings[id]
      return autoSignature(f.ruleId, draft.instances[f.instanceId].component, f.evidence.rootCauseKey)
    }),
  )
  draft.groups[newGroupId] = {
    id: newGroupId,
    autoSignature: sigs.size === 1 ? [...sigs][0] : null,
    origin: 'split',
    memberIds: moving,
    activeCandidateId: null,
    archived: false,
    createdAt: now,
  }
  source.memberIds = source.memberIds.filter((id) => !moving.includes(id))

  const pageIds = [...new Set(moving.map((id) => draft.findings[id].pageId))]
  const verifiedMoving = moving.filter((id) =>
    draft.verifications.some(
      (v) => v.findingId === id && v.candidateId === source.activeCandidateId && v.result === 'pass',
    ),
  ).length

  logImpact(
    draft,
    'split',
    `拆分 ${groupId} → 新组 ${newGroupId}（${moving.length} 条命中）`,
    `影响 ${pageIds.length} 个页面：${pageIds.map((p) => draft.pages[p].name).join('、')}。新组不继承修复候选，${verifiedMoving} 条曾在旧候选下通过的页面证据需要重新验证；旧组剩余 ${source.memberIds.length} 条命中的结论不受影响。`,
    { groupIds: [groupId, newGroupId], findingIds: moving, pageIds },
    now,
  )

  return { state: draft, newGroupId, affectedPageIds: pageIds }
}

export interface MergeResult {
  state: AppState
  newGroupId: GroupId
  affectedPageIds: PageId[]
}

/** 合并多个修复组为一个人工组；各组候选互不等同，全部成员需要在新候选下重新验证 */
export function mergeGroups(
  state: AppState,
  groupIds: GroupId[],
  now: number = Date.now(),
): MergeResult {
  const draft = cloneState(state)
  const uniq = [...new Set(groupIds)]
  if (uniq.length < 2) throw new Error('请至少选择两个修复组进行合并')
  const sources = uniq.map((id) => requireActiveGroup(draft, id))

  const newGroupId = nextId(draft, 'grp_')
  const memberIds = sources
    .flatMap((g) => g.memberIds)
    .sort()
  draft.groups[newGroupId] = {
    id: newGroupId,
    autoSignature: null,
    origin: 'merged',
    memberIds,
    activeCandidateId: null,
    archived: false,
    createdAt: now,
  }
  for (const g of sources) g.archived = true

  const pageIds = [...new Set(memberIds.map((id) => draft.findings[id].pageId))]
  logImpact(
    draft,
    'merge',
    `合并 ${uniq.join(' + ')} → 新组 ${newGroupId}（${memberIds.length} 条命中）`,
    `影响 ${pageIds.length} 个页面：${pageIds.map((p) => draft.pages[p].name).join('、')}。合并组为人工组，自动归并不再向其添加新命中；原各组的候选与验证结论互不通用，提交新候选后需逐页重新验证。`,
    { groupIds: [newGroupId, ...uniq], findingIds: memberIds, pageIds },
    now,
  )

  return { state: draft, newGroupId, affectedPageIds: pageIds }
}

export interface CandidateInput {
  summary: string
  detail: string
  fixVersion: string
}

export interface CandidateResult {
  state: AppState
  candidateId: CandidateId
  replacedCandidateId: CandidateId | null
}

/** 提交修复候选；替换旧候选时，旧候选下的通过结论不再关闭任何问题 */
export function submitCandidate(
  state: AppState,
  groupId: GroupId,
  input: CandidateInput,
  now: number = Date.now(),
): CandidateResult {
  const draft = cloneState(state)
  const group = requireActiveGroup(draft, groupId)
  const replacedId = group.activeCandidateId
  const candidateId = nextId(draft, 'cand_')
  const candidate: FixCandidate = {
    id: candidateId,
    groupId,
    summary: input.summary,
    detail: input.detail,
    fixVersion: input.fixVersion,
    createdAt: now,
    superseded: false,
  }
  draft.candidates[candidateId] = candidate
  group.activeCandidateId = candidateId

  if (replacedId) {
    draft.candidates[replacedId].superseded = true
    const pageIds = [...new Set(group.memberIds.map((id) => draft.findings[id].pageId))]
    const passedCount = group.memberIds.filter((id) =>
      draft.verifications.some((v) => v.findingId === id && v.candidateId === replacedId && v.result === 'pass'),
    ).length
    logImpact(
      draft,
      'candidate-replaced',
      `组 ${groupId} 的修复候选已替换为 ${candidateId}`,
      `旧候选 ${replacedId} 下 ${passedCount} 个页面的通过结论仅作为历史快照保留，不再视为已关闭；全部 ${group.memberIds.length} 条页面证据需在新候选（版本 ${input.fixVersion}）下重新验证。`,
      { groupIds: [groupId], findingIds: group.memberIds, pageIds },
      now,
    )
  }

  return { state: draft, candidateId, replacedCandidateId: replacedId }
}

export interface VerifyInput {
  groupId: GroupId
  findingId: FindingId
  result: VerifyResult
  note?: string
  /** 验证时页面所在代码版本，缺省沿用命中记录的版本 */
  codeVersion?: string
}

export interface VerifyResult2 {
  state: AppState
  verificationId: string
  duplicated: boolean
  regression: boolean
}

/** 在某个页面情景中重新验证当前候选；结论逐页独立，部分通过不影响其他页面 */
export function recordVerification(
  state: AppState,
  input: VerifyInput,
  now: number = Date.now(),
): VerifyResult2 {
  const draft = cloneState(state)
  const group = requireActiveGroup(draft, input.groupId)
  if (!group.memberIds.includes(input.findingId)) throw new Error('该命中不属于此修复组')
  const candidateId = group.activeCandidateId
  if (!candidateId) throw new Error('请先提交修复候选，再记录验证结果')
  const finding = draft.findings[input.findingId]
  const instance = draft.instances[finding.instanceId]
  const codeVersion = input.codeVersion ?? finding.codeVersion

  const prior = [
    ...draft.verifications
      .filter((v) => v.findingId === input.findingId && v.candidateId === candidateId)
      .sort((a, b) => a.at - b.at),
  ].pop()

  // 重复验证：同一候选、同一现场、同一结论 → 幂等，不产生新快照
  if (
    prior &&
    prior.result === input.result &&
    prior.scanSeq === finding.scanSeq &&
    prior.evidenceHash === finding.evidence.hash &&
    prior.instanceVersion === instance.version &&
    prior.codeVersion === codeVersion
  ) {
    logImpact(
      draft,
      'duplicate-verification',
      `重复验证已忽略（${draft.pages[finding.pageId].name} · ${input.result === 'pass' ? '通过' : '未通过'}）`,
      `验证现场（扫描轮次 ${finding.scanSeq}、证据 ${finding.evidence.hash}、页面版本 ${codeVersion}、实例版本 ${instance.version}）与已有快照 ${prior.id} 完全一致，未重复计数。`,
      { groupIds: [input.groupId], findingIds: [input.findingId], pageIds: [finding.pageId] },
      now,
    )
    return { state: draft, verificationId: prior.id, duplicated: true, regression: false }
  }

  const verification: Verification = {
    id: nextId(draft, 'vrf_'),
    candidateId,
    groupId: input.groupId,
    findingId: input.findingId,
    pageId: finding.pageId,
    result: input.result,
    note: input.note ?? '',
    codeVersion,
    instanceVersion: instance.version,
    scanSeq: finding.scanSeq,
    evidenceHash: finding.evidence.hash,
    evidenceSnapshot: finding.evidence.snippet,
    at: now,
  }
  draft.verifications.push(verification)

  // 修复回归：同一证据现场下，最近结论由通过变为未通过
  let regression = false
  if (
    prior &&
    prior.result === 'pass' &&
    input.result === 'fail' &&
    prior.evidenceHash === finding.evidence.hash &&
    prior.scanSeq === finding.scanSeq
  ) {
    regression = true
    logImpact(
      draft,
      'regression',
      `检测到修复回归：${draft.pages[finding.pageId].name} 由通过变回未通过`,
      `命中 ${input.findingId} 在同一证据现场（轮次 ${finding.scanSeq}、证据 ${finding.evidence.hash}）下，最近验证从通过翻转为未通过。该页面证据重新置为未通过，同组其他页面结论不受影响，组不能被关闭。`,
      { groupIds: [input.groupId], findingIds: [input.findingId], pageIds: [finding.pageId] },
      now,
    )
  }

  return { state: draft, verificationId: verification.id, duplicated: false, regression }
}

/** 实例换版：该实例所有已验证结论因验证现场变化而过期，需要重新确认 */
export function changeInstanceVersion(
  state: AppState,
  instanceId: InstanceId,
  newVersion: string,
  now: number = Date.now(),
): AppState {
  const draft = cloneState(state)
  const instance = draft.instances[instanceId]
  if (!instance) throw new Error('组件实例不存在')
  if (instance.version === newVersion) return state

  const oldVersion = instance.version
  instance.version = newVersion

  const affectedFindingIds = Object.values(draft.findings)
    .filter((f) => f.instanceId === instanceId)
    .map((f) => f.id)
  const groupIds = [
    ...new Set(
      affectedFindingIds
        .map((id) => Object.values(draft.groups).find((g) => g.memberIds.includes(id))?.id)
        .filter((g): g is GroupId => Boolean(g)),
    ),
  ]
  const pageIds = [...new Set(affectedFindingIds.map((id) => draft.findings[id].pageId))]

  logImpact(
    draft,
    'instance-version',
    `实例 ${instance.label} 换版：${oldVersion} → ${newVersion}`,
    `影响 ${affectedFindingIds.length} 条页面证据、${groupIds.length} 个修复组、${pageIds.length} 个页面：${pageIds.map((p) => draft.pages[p]?.name).join('、')}。这些证据此前在实例版本 ${oldVersion} 下得到的通过结论已过期，需在 ${newVersion} 上重新验证；未验证的证据状态不变。`,
    { groupIds, findingIds: affectedFindingIds, pageIds },
    now,
  )
  return draft
}

export interface RefreshInput {
  findingId: FindingId
  codeVersion: string
  evidence: Omit<Evidence, 'hash'>
}

export interface RefreshResult {
  state: AppState
  changed: boolean
  groupId?: GroupId
}

/** 刷新一条页面证据；证据指纹或页面版本变化才会使旧验证快照过期 */
export function refreshEvidence(
  state: AppState,
  input: RefreshInput,
  now: number = Date.now(),
): RefreshResult {
  const draft = cloneState(state)
  const finding = draft.findings[input.findingId]
  if (!finding) throw new Error('命中不存在，无法刷新证据')
  const newHash = evidenceFingerprint(input.evidence)
  if (newHash === finding.evidence.hash && input.codeVersion === finding.codeVersion) {
    return { state, changed: false }
  }

  const groupId = groupOfFinding(draft, finding.id)
  draft.scanSeq += 1
  const oldSeq = finding.scanSeq
  const oldRootCause = finding.evidence.rootCauseKey
  const rootCauseChanged = input.evidence.rootCauseKey !== oldRootCause
  finding.scanSeq = draft.scanSeq
  finding.codeVersion = input.codeVersion
  finding.evidence = { ...input.evidence, hash: newHash }

  const notes: string[] = [
    `证据由轮次 ${oldSeq} 更新到轮次 ${draft.scanSeq}，此前针对旧证据的验证快照（${draft.verifications.filter((v) => v.findingId === finding.id).length} 条）全部标记为过期，需在页面版本 ${input.codeVersion} 上重新验证。`,
    '该失效只影响当前页面这一条证据，同组其他页面的结论不受影响。',
  ]
  if (rootCauseChanged) {
    notes.push(
      `根因键由「${oldRootCause}」变为「${input.evidence.rootCauseKey}」，但归并决策保持稳定，命中仍留在原组；如确认根因不同，请人工拆分。`,
    )
  }

  logImpact(
    draft,
    'evidence-refresh',
    `页面证据已刷新：${draft.pages[finding.pageId].name}（新指纹 ${newHash}）`,
    notes.join(''),
    { groupIds: groupId ? [groupId] : [], findingIds: [finding.id], pageIds: [finding.pageId] },
    now,
  )
  return { state: draft, changed: true, groupId }
}

/** 一键复位：清空全部录入、归并、候选、验证快照与影响记录 */
export function resetAll(now: number = Date.now()): AppState {
  const fresh = createInitialState()
  fresh.seq = 1
  fresh.impactLog.push({
    id: 'imp_1',
    kind: 'reset',
    at: now,
    summary: '工作台已一键复位',
    detail: '全部页面、实例、命中、修复组、候选与验证快照均已清空，撤销/重做历史一并重置。',
    groupIds: [],
    findingIds: [],
    pageIds: [],
  })
  return fresh
}
