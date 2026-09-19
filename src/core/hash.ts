import type { Evidence } from './types'

/** 稳定的 32 位字符串哈希（FNV-1a），保证证据指纹可重复计算 */
export function stableHash(input: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

/** 由证据内容计算指纹（不含 hash 字段本身） */
export function evidenceFingerprint(e: Omit<Evidence, 'hash'>): string {
  return stableHash([e.selector, e.snippet, e.observed, e.rootCauseKey].join('|'))
}

export function nextId(state: { seq: number }, prefix: string): string {
  return `${prefix}${state.seq + 1}`
}
