import { useState } from 'react'
import { store, useStore } from '../core/store'

interface Props {
  onClose: () => void
  onIngested: (groupId: string) => void
}

/** 录入一次扫描发现：页面 + 组件实例 + 规则命中 */
export function IngestDialog({ onClose, onIngested }: Props) {
  const state = useStore()
  const [pageMode, setPageMode] = useState<'existing' | 'new'>(
    Object.keys(state.pages).length ? 'existing' : 'new',
  )
  const [pageId, setPageId] = useState(Object.keys(state.pages)[0] ?? '')
  const [pageName, setPageName] = useState('')
  const [pageUrl, setPageUrl] = useState('')

  const [instMode, setInstMode] = useState<'existing' | 'new'>(
    Object.keys(state.instances).length ? 'existing' : 'new',
  )
  const [instanceId, setInstanceId] = useState(Object.keys(state.instances)[0] ?? '')
  const [component, setComponent] = useState('Button')
  const [instLabel, setInstLabel] = useState('')
  const [instVersion, setInstVersion] = useState('')

  const [ruleId, setRuleId] = useState('button-name')
  const [ruleTitle, setRuleTitle] = useState('按钮缺少可访问名称')
  const [codeVersion, setCodeVersion] = useState('')
  const [selector, setSelector] = useState('')
  const [snippet, setSnippet] = useState('')
  const [observed, setObserved] = useState('')
  const [rootCauseKey, setRootCauseKey] = useState('')
  const [error, setError] = useState('')

  function submit() {
    setError('')
    try {
      let targetPageId = pageId
      if (pageMode === 'new') {
        if (!pageName.trim() || !pageUrl.trim()) throw new Error('请填写页面名称与 URL')
        targetPageId = store.addPage({ name: pageName.trim(), url: pageUrl.trim() })
      }
      let targetInstanceId = instanceId
      if (instMode === 'new') {
        if (!component.trim() || !instLabel.trim() || !instVersion.trim()) {
          throw new Error('请填写组件类型、实例标签与版本')
        }
        targetInstanceId = store.addInstance({
          component: component.trim(),
          label: instLabel.trim(),
          version: instVersion.trim(),
        })
      }
      if (!ruleId.trim() || !ruleTitle.trim() || !codeVersion.trim()) throw new Error('请填写规则与页面代码版本')
      if (!selector.trim() || !observed.trim() || !rootCauseKey.trim()) throw new Error('请填写证据：selector、现象与根因键')
      const r = store.ingest({
        pageId: targetPageId,
        instanceId: targetInstanceId,
        ruleId: ruleId.trim(),
        ruleTitle: ruleTitle.trim(),
        codeVersion: codeVersion.trim(),
        evidence: {
          selector: selector.trim(),
          snippet: snippet.trim(),
          observed: observed.trim(),
          rootCauseKey: rootCauseKey.trim(),
        },
      })
      onIngested(r.groupId)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const pageOptions = Object.values(state.pages)
  const instOptions = Object.values(state.instances)

  return (
    <div
      role="dialog"
      aria-label="录入扫描命中"
      style={{
        position: 'fixed', inset: 0, background: 'rgba(20,30,50,0.35)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50,
      }}
      onClick={onClose}
    >
      <div
        className="panel"
        style={{ width: 560, maxWidth: '92vw', maxHeight: '88vh', overflow: 'auto', padding: 16 }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={{ margin: '0 0 12px' }}>录入扫描命中（页面 · 组件实例 · 规则 · 代码版本 · 证据）</h3>

        <div className="field">
          <label>页面</label>
          <div className="row-actions">
            <label>
              <input type="radio" style={{ width: 'auto' }} checked={pageMode === 'existing'}
                onChange={() => setPageMode('existing')} disabled={pageOptions.length === 0} /> 已有页面
            </label>
            <label>
              <input type="radio" style={{ width: 'auto' }} checked={pageMode === 'new'}
                onChange={() => setPageMode('new')} /> 新页面
            </label>
          </div>
          {pageMode === 'existing' ? (
            <select value={pageId} onChange={(e) => setPageId(e.target.value)}>
              {pageOptions.map((p) => <option key={p.id} value={p.id}>{p.name}（{p.url}）</option>)}
            </select>
          ) : (
            <div className="row-actions">
              <input placeholder="页面名称，如 商品详情" value={pageName} onChange={(e) => setPageName(e.target.value)} />
              <input placeholder="URL，如 /product/42" value={pageUrl} onChange={(e) => setPageUrl(e.target.value)} />
            </div>
          )}
        </div>

        <div className="field">
          <label>组件实例</label>
          <div className="row-actions">
            <label>
              <input type="radio" style={{ width: 'auto' }} checked={instMode === 'existing'}
                onChange={() => setInstMode('existing')} disabled={instOptions.length === 0} /> 已有实例
            </label>
            <label>
              <input type="radio" style={{ width: 'auto' }} checked={instMode === 'new'}
                onChange={() => setInstMode('new')} /> 新实例
            </label>
          </div>
          {instMode === 'existing' ? (
            <select value={instanceId} onChange={(e) => setInstanceId(e.target.value)}>
              {instOptions.map((i) => (
                <option key={i.id} value={i.id}>{i.component} · {i.label}（{i.version}）</option>
              ))}
            </select>
          ) : (
            <>
              <div className="row-actions">
                <input placeholder="组件类型，如 Button" value={component} onChange={(e) => setComponent(e.target.value)} />
                <input placeholder="实例标签" value={instLabel} onChange={(e) => setInstLabel(e.target.value)} />
                <input placeholder="版本，如 design-system@3.1.0" value={instVersion}
                  onChange={(e) => setInstVersion(e.target.value)} />
              </div>
            </>
          )}
        </div>

        <div className="field">
          <label>规则命中</label>
          <div className="row-actions">
            <input placeholder="ruleId，如 button-name" value={ruleId} onChange={(e) => setRuleId(e.target.value)} />
            <input placeholder="规则标题" value={ruleTitle} onChange={(e) => setRuleTitle(e.target.value)} />
            <input placeholder="扫描时页面代码版本，如 app@2026.09.01" value={codeVersion}
              onChange={(e) => setCodeVersion(e.target.value)} />
          </div>
        </div>

        <div className="field">
          <label>独立页面证据</label>
          <input placeholder="selector，如 .btn-primary.icon-only" value={selector}
            onChange={(e) => setSelector(e.target.value)} />
          <input placeholder="观察到的现象" value={observed} onChange={(e) => setObserved(e.target.value)} style={{ marginTop: 6 }} />
          <input placeholder="根因键（同组件同规则同根因才会自动归并）" value={rootCauseKey}
            onChange={(e) => setRootCauseKey(e.target.value)} style={{ marginTop: 6 }} />
          <textarea placeholder="代码片段（可选）" value={snippet} onChange={(e) => setSnippet(e.target.value)} style={{ marginTop: 6 }} />
        </div>

        {error && <p style={{ color: 'var(--bad)', fontSize: 12 }}>{error}</p>}
        <div className="row-actions" style={{ justifyContent: 'flex-end', marginTop: 8 }}>
          <button className="btn" onClick={onClose}>取消</button>
          <button className="btn primary" onClick={submit}>录入并归并</button>
        </div>
      </div>
    </div>
  )
}
