/** 归并键与自动归并规则 */
import type { AppState, FixGroup, ID } from "./types";

/**
 * 根因归并 signature：同一规则命中同一组件名，即视为可能来自同一组件根因。
 * 纯函数、与录入顺序无关 —— 这是归并稳定性的基础。
 */
export function signatureOf(ruleId: string, componentName: string): string {
  return `${ruleId}@@${componentName}`;
}

export function findGroupForSignature(
  state: AppState,
  signature: string
): FixGroup | undefined {
  return Object.values(state.groups).find((g) => g.signature === signature);
}

export function groupContainingHit(
  state: AppState,
  hitId: ID
): FixGroup | undefined {
  return Object.values(state.groups).find((g) => g.hitIds.includes(hitId));
}

export function canonicalTitle(
  componentName: string,
  ruleTitle: string
): string {
  return `${componentName} · ${ruleTitle}`;
}
