/** 领域模型：页面 / 组件实例 / 规则命中 / 修复组 / 修复候选 / 复验记录 */

export type ID = string;

export type Severity = "critical" | "serious" | "moderate" | "minor";

export interface Page {
  id: ID;
  name: string;
  url: string;
}

export interface ComponentInstance {
  id: ID;
  pageId: ID;
  /** 组件名，如 Button / IconButton */
  componentName: string;
  /** 页面内稳定选择器，用于区分同一页面上的多个实例 */
  selector: string;
  /** 实例当前代码版本，如 button@2.1.0 */
  version: string;
}

/** 一次扫描留下的独立证据，始终挂在具体页面的具体实例上 */
export interface Evidence {
  snippet: string;
  /** 采集时间（epoch ms） */
  observedAt: number;
  /** 采集时实例的代码版本 */
  codeVersion: string;
}

export interface RuleHit {
  id: ID;
  instanceId: ID;
  ruleId: string;
  ruleTitle: string;
  severity: Severity;
  evidence: Evidence;
  foundAt: number;
}

/**
 * 修复组：把可能来自同一组件根因的命中归并在一起。
 * signature 非空表示自动归并组（同 signature 的新命中持续并入）；
 * 拆分 / 跨 signature 合并产生的手工组 signature 为 null，不再自动吸纳新命中。
 */
export interface FixGroup {
  id: ID;
  title: string;
  ruleId: string;
  componentName: string;
  signature: string | null;
  hitIds: ID[];
  createdAt: number;
  manual?: boolean;
}

/** 一次修复尝试：针对某个修复组提交一个修复候选 */
export interface FixCandidate {
  id: ID;
  groupId: ID;
  title: string;
  description?: string;
  createdAt: number;
}

export type Verdict = "pass" | "fail";

/** 单条页面级复验记录；同一候选 + 同一命中可以重复验证，追加不覆盖 */
export interface Verification {
  id: ID;
  candidateId: ID;
  hitId: ID;
  pageId: ID;
  verdict: Verdict;
  /** 验证时实例的代码版本，用于检测换版后的过期通过 */
  instanceVersion: string;
  checkedAt: number;
  note?: string;
}

export interface AppState {
  pages: Record<ID, Page>;
  instances: Record<ID, ComponentInstance>;
  hits: Record<ID, RuleHit>;
  groups: Record<ID, FixGroup>;
  candidates: Record<ID, FixCandidate>;
  verifications: Verification[];
}

/** 单条命中在“当前最新候选”下的状态 */
export type HitStatus =
  | "open" // 组里还没有修复候选
  | "pending" // 有候选，尚未复验
  | "passed" // 最新复验通过，且版本未漂移
  | "failed" // 最新复验不通过
  | "stale" // 曾通过，但实例已换版，需要重新验证
  | "regressed"; // 曾经通过，最新复验又失败（回归）

export type GroupStatus =
  | "open"
  | "pending"
  | "resolved" // 全部页面均通过且证据新鲜
  | "partial" // 部分页面通过，未通过 / 待验项不跟着关闭
  | "failed"
  | "stale" // 过去的通过全部因换版过期
  | "regressed";

export interface ImpactNote {
  tone: "info" | "good" | "warn" | "bad";
  title: string;
  lines: string[];
}
