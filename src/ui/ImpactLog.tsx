import { useStore } from '../core/store'
import { formatTime } from './badges'

const KIND_LABEL: Record<string, string> = {
  'auto-group-created': '自动归并',
  split: '拆分',
  merge: '合并',
  'instance-version': '实例换版',
  'evidence-refresh': '证据刷新',
  regression: '修复回归',
  'candidate-replaced': '候选替换',
  'duplicate-verification': '重复验证',
  reset: '复位',
}

export function ImpactLog() {
  const state = useStore()
  const entries = [...state.impactLog].reverse()
  return (
    <div className="panel">
      <h2>影响范围解释（{entries.length}）</h2>
      <div className="impact-list">
        {entries.length === 0 && <div className="empty">暂无操作记录</div>}
        {entries.map((e) => (
          <div key={e.id} className={`impact-item kind-${e.kind}`}>
            <div className="row-actions">
              <b>{KIND_LABEL[e.kind] ?? e.kind}</b>
              <span className="ii-time">{formatTime(e.at)}</span>
            </div>
            <div className="ii-time" style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 2 }}>{e.summary}</div>
            <p className="ii-detail">{e.detail}</p>
            {(e.groupIds.length > 0 || e.pageIds.length > 0) && (
              <div style={{ marginTop: 4, fontSize: 11.5, color: 'var(--muted)' }}>
                {e.groupIds.length > 0 && <span>组：{e.groupIds.join(', ')}　</span>}
                {e.pageIds.length > 0 && <span>{e.pageIds.length} 个页面受影响</span>}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
