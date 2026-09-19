// 核心领域模型：页面、组件实例、规则命中（证据）、修复组、修复候选、验证快照

export type PageId = string
export type InstanceId = string
export type FindingId = string
export type GroupId = string
export type CandidateId = string
export type VerificationId = string
export type ImpactId = string

/** 规则命中证据：扫描器在某个页面的某个组件实例上观察到的内容 */
export interface Evidence {
  /** 定位方式，例如 CSS selector / DOM 路径 */
  selector: string
  /** 命中时的代码片段（HTML / 属性摘要） */
  snippet: string
  /** 观察到的现象，例如 “accessible name 为空” */
  observed: string
  /**
   * 根因键：归并的主要依据。同一组件、同一规则、同一根因键的命中
   * 才会被自动归并到同一修复组。
   */
  rootCauseKey: string
  /** 证据指纹，刷新时用于判断证据是否真的发生了变化 */
  hash: string
}

export interface Page {
  id: PageId
  name: string
  url: string
}

export interface ComponentInstance {
  id: InstanceId
  /** 组件类型，例如 Button / IconButton */
  component: string
  /** 实例标签，便于人识别，例如 “结算页-提交订单按钮” */
  label: string
  /** 实例当前所在的代码版本（实例换版时更新） */
  version: string
}

/** 一次规则命中 = 某页面上某实例的一条独立证据 */
export interface Finding {
  id: FindingId
  pageId: PageId
  instanceId: InstanceId
  ruleId: string
  ruleTitle: string
  /** 扫描时页面的代码版本 */
  codeVersion: string
  evidence: Evidence
  /** 第几次扫描得到该证据，每次刷新 +1，用于判定验证是否过期 */
  scanSeq: number
  createdAt: number
}

export type GroupOrigin = 'auto' | 'split' | 'merged'

export interface FixGroup {
  id: GroupId
  /**
   * 自动归并签名：ruleId|component|rootCauseKey。
   * 手动合并出的组（成员签名不一致）为 null，自动归并不会再往里塞新命中。
   */
  autoSignature: string | null
  origin: GroupOrigin
  memberIds: FindingId[]
  activeCandidateId: CandidateId | null
  archived: boolean
  createdAt: number
}

export interface FixCandidate {
  id: CandidateId
  groupId: GroupId
  summary: string
  detail: string
  /** 声称包含修复的代码版本 */
  fixVersion: string
  createdAt: number
  /** 被新候选替换后置真，保留用于快照查看 */
  superseded: boolean
}

export type VerifyResult = 'pass' | 'fail'

/** 一次逐页验证的不可变快照 */
export interface Verification {
  id: VerificationId
  candidateId: CandidateId
  groupId: GroupId
  findingId: FindingId
  pageId: PageId
  result: VerifyResult
  note: string
  /** 验证时页面所在代码版本 */
  codeVersion: string
  /** 验证时实例所在版本 */
  instanceVersion: string
  /** 验证针对第几轮扫描证据 */
  scanSeq: number
  /** 验证现场证据快照（指纹 + 片段） */
  evidenceHash: string
  evidenceSnapshot: string
  at: number
}

export type ImpactKind =
  | 'auto-group-created'
  | 'split'
  | 'merge'
  | 'instance-version'
  | 'evidence-refresh'
  | 'regression'
  | 'candidate-replaced'
  | 'duplicate-verification'
  | 'reset'

export interface ImpactEntry {
  id: ImpactId
  kind: ImpactKind
  at: number
  summary: string
  /** 影响范围：组、命中（页面证据）、页面 */
  groupIds: GroupId[]
  findingIds: FindingId[]
  pageIds: PageId[]
  detail: string
}

export interface AppState {
  seq: number
  /** 全局扫描轮次，每次有证据刷新时 +1 */
  scanSeq: number
  pages: Record<PageId, Page>
  instances: Record<InstanceId, ComponentInstance>
  findings: Record<FindingId, Finding>
  groups: Record<GroupId, FixGroup>
  candidates: Record<CandidateId, FixCandidate>
  verifications: Verification[]
  impactLog: ImpactEntry[]
}

/** 派生的单条命中级状态 */
export type FindingStatus = 'open' | 'failed' | 'verified' | 'stale'

/** 派生的修复组状态 */
export type GroupStatus = 'open' | 'fixing' | 'partial' | 'resolved'

export interface ScopeCount {
  total: number
  verified: number
  failed: number
  stale: number
  open: number
}
