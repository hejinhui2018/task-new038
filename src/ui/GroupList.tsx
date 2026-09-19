import { allGroupViews } from '../core/selectors'
import { useStore } from '../core/store'
import { GroupBadge, OriginBadge } from './badges'

interface Props {
  selectedId: string | null
  onSelect: (id: string) => void
  mergeMode: boolean
  mergeSelection: string[]
  onToggleMerge: (id: string) => void
}

export function GroupList({ selectedId, onSelect, mergeMode, mergeSelection, onToggleMerge }: Props) {
  const state = useStore()
  const views = allGroupViews(state)

  return (
    <div className="panel">
      <h2>修复组（{views.length}）</h2>
      <div className="stat-row">
        <span>待修复 <b>{views.filter((v) => v.status === 'open').length}</b></span>
        <span>验证中 <b>{views.filter((v) => v.status === 'fixing').length}</b></span>
        <span>部分通过 <b>{views.filter((v) => v.status === 'partial').length}</b></span>
        <span>全部通过 <b>{views.filter((v) => v.status === 'resolved').length}</b></span>
      </div>
      {views.length === 0 && <div className="empty">还没有录入规则命中</div>}
      {views.map((v) => {
        const rule = v.findings[0]?.finding.ruleTitle ?? ''
        return (
          <div
            key={v.group.id}
            className={`group-item ${selectedId === v.group.id ? 'selected' : ''}`}
            onClick={() => (mergeMode ? onToggleMerge(v.group.id) : onSelect(v.group.id))}
          >
            <div className="gi-title">
              {mergeMode && (
                <input
                  type="checkbox"
                  checked={mergeSelection.includes(v.group.id)}
                  onChange={() => onToggleMerge(v.group.id)}
                  onClick={(e) => e.stopPropagation()}
                  aria-label="选择要合并的组"
                />
              )}
              <GroupBadge status={v.status} />
              <OriginBadge origin={v.group.origin} />
            </div>
            <div>{rule}</div>
            <div className="gi-meta">
              {v.counts.total} 条页面证据 · 覆盖 {v.pages.length} 页
              {v.counts.verified > 0 && ` · 通过 ${v.counts.verified}`}
              {v.counts.failed > 0 && ` · 未通过 ${v.counts.failed}`}
              {v.counts.stale > 0 && ` · 过期 ${v.counts.stale}`}
            </div>
            {v.group.autoSignature && (
              <div className="gi-meta mono">{v.group.autoSignature}</div>
            )}
          </div>
        )
      })}
      <div className="footer-hint">点击修复组查看逐页证据与验证矩阵；勾选模式下可选择多组进行合并</div>
    </div>
  )
}
