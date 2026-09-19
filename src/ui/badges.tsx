import type { FindingStatus, GroupStatus } from '../core/types'
import type { SnapshotValidity } from '../core/selectors'

const GROUP_LABEL: Record<GroupStatus, string> = {
  open: '待修复',
  fixing: '验证中',
  partial: '部分通过',
  resolved: '全部通过',
}

const FINDING_LABEL: Record<FindingStatus, string> = {
  open: '未验证',
  failed: '未通过',
  verified: '已验证通过',
  stale: '快照过期',
}

export function GroupBadge({ status }: { status: GroupStatus }) {
  return <span className={`badge ${status}`}>{GROUP_LABEL[status]}</span>
}

export function FindingBadge({ status }: { status: FindingStatus }) {
  return <span className={`badge ${status}`}>{FINDING_LABEL[status]}</span>
}

const VALIDITY_LABEL: Record<SnapshotValidity, string> = {
  current: '当前有效',
  'stale-evidence': '证据已过期',
  'stale-version': '版本已过期',
  superseded: '候选已替换',
}

export function ValidityBadge({ validity }: { validity: SnapshotValidity }) {
  const cls = validity === 'current' ? 'verified' : 'stale'
  return <span className={`badge ${cls}`}>{VALIDITY_LABEL[validity]}</span>
}

export function OriginBadge({ origin }: { origin: 'auto' | 'split' | 'merged' }) {
  const label = origin === 'auto' ? '自动归并' : origin === 'split' ? '人工拆分' : '人工合并'
  return <span className="badge origin">{label}</span>
}

export function formatTime(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
