import { useSyncExternalStore } from 'react'
import {
  addInstance,
  addPage,
  changeInstanceVersion,
  cloneState,
  createInitialState,
  ingestFinding,
  mergeGroups,
  recordVerification,
  refreshEvidence,
  resetAll,
  splitGroup,
  submitCandidate,
  type CandidateInput,
  type FindingInput,
  type InstanceInput,
  type PageInput,
  type RefreshInput,
  type VerifyInput,
} from './commands'
import type { AppState, GroupId, InstanceId } from './types'

const STORAGE_KEY = 'access-review:state:v1'
const STORAGE_TS_KEY = 'access-review:state:v1:savedAt'
const HISTORY_LIMIT = 100

interface PersistShape {
  state: AppState
  savedAt: number | null
}

function persist(state: AppState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    localStorage.setItem(STORAGE_TS_KEY, String(Date.now()))
  } catch {
    // 存储不可用时静默降级为纯内存模式
  }
}

function isValidState(value: unknown): value is AppState {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.seq === 'number' &&
    typeof v.pages === 'object' &&
    typeof v.instances === 'object' &&
    typeof v.findings === 'object' &&
    typeof v.groups === 'object' &&
    typeof v.candidates === 'object' &&
    Array.isArray(v.verifications) &&
    Array.isArray(v.impactLog)
  )
}

export function loadState(): PersistShape {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const tsRaw = localStorage.getItem(STORAGE_TS_KEY)
    if (!raw) return { state: createInitialState(), savedAt: null }
    const parsed: unknown = JSON.parse(raw)
    if (!isValidState(parsed)) return { state: createInitialState(), savedAt: null }
    return { state: parsed, savedAt: tsRaw ? Number(tsRaw) : null }
  } catch {
    return { state: createInitialState(), savedAt: null }
  }
}

export function clearStorage() {
  try {
    localStorage.removeItem(STORAGE_KEY)
    localStorage.removeItem(STORAGE_TS_KEY)
  } catch {
    // ignore
  }
}

export class ReviewStore {
  private past: AppState[] = []
  private present: AppState
  private future: AppState[] = []
  private listeners = new Set<() => void>()
  restoredAt: number | null

  constructor(initial: AppState, restoredAt: number | null) {
    this.present = initial
    this.restoredAt = restoredAt
  }

  getState = (): AppState => this.present

  canUndo = (): boolean => this.past.length > 0
  canRedo = (): boolean => this.future.length > 0

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit() {
    this.listeners.forEach((l) => l())
  }

  /** 所有领域命令统一经此入口：入栈、截断、持久化 */
  commit(next: AppState) {
    if (next === this.present) {
      this.emit()
      return
    }
    this.past.push(this.present)
    if (this.past.length > HISTORY_LIMIT) this.past.shift()
    this.present = next
    this.future = []
    persist(next)
    this.emit()
  }

  undo() {
    const prev = this.past.pop()
    if (!prev) return
    this.future.unshift(this.present)
    this.present = prev
    persist(prev)
    this.emit()
  }

  redo() {
    const next = this.future.shift()
    if (!next) return
    this.past.push(this.present)
    this.present = next
    persist(next)
    this.emit()
  }

  hardReset(state: AppState) {
    this.past = []
    this.future = []
    this.present = state
    persist(state)
    this.emit()
  }

  // ---- 领域动作 ----

  addPage(input: PageInput) {
    const r = addPage(this.present, input)
    this.commit(r.state)
    return r.pageId
  }

  addInstance(input: InstanceInput) {
    const r = addInstance(this.present, input)
    this.commit(r.state)
    return r.instanceId
  }

  ingest(input: FindingInput) {
    const r = ingestFinding(this.present, input)
    this.commit(r.state)
    return r
  }

  split(groupId: GroupId, memberIds: string[]) {
    const r = splitGroup(this.present, groupId, memberIds)
    this.commit(r.state)
    return r
  }

  merge(groupIds: GroupId[]) {
    const r = mergeGroups(this.present, groupIds)
    this.commit(r.state)
    return r
  }

  submitCandidate(groupId: GroupId, input: CandidateInput) {
    const r = submitCandidate(this.present, groupId, input)
    this.commit(r.state)
    return r
  }

  verify(input: VerifyInput) {
    const r = recordVerification(this.present, input)
    this.commit(r.state)
    return r
  }

  changeVersion(instanceId: InstanceId, version: string) {
    this.commit(changeInstanceVersion(this.present, instanceId, version))
  }

  refresh(input: RefreshInput) {
    const r = refreshEvidence(this.present, input)
    this.commit(r.state)
    return r
  }

  reset() {
    this.hardReset(resetAll())
  }

  /** 测试与种子注入用 */
  replaceState(state: AppState) {
    this.hardReset(state)
  }

  snapshotPresent(): AppState {
    return cloneState(this.present)
  }
}

export function createStore(): ReviewStore {
  const { state: initial, savedAt } = loadState()
  return new ReviewStore(initial, savedAt)
}

export const store = createStore()

export function useStore(): AppState {
  return useSyncExternalStore(store.subscribe, store.getState, store.getState)
}
