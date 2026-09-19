import { useState } from 'react'
import { snapshotValidity, verificationHistory, viewGroup } from '../core/selectors'
import { store, useStore } from '../core/store'
import type { FixGroup, GroupId } from '../core/types'
import { FindingBadge, GroupBadge, OriginBadge, ValidityBadge, formatTime } from './badges'

interface Props {
  groupId: GroupId
  onSplitDone: (newGroupId: GroupId) => void
}

export function GroupDetail({ groupId, onSplitDone }: Props) {
  const state = useStore()
  const group = state.groups[groupId]
  if (!group || group.archived) {
    return <div className="panel empty">该修复组不存在或已随合并归档。</div>
  }
  return (
    <div className="detail">
      <GroupHeader group={group} />
      <CandidatePanel group={group} />
      <VerifyMatrix groupId={group.id} onSplitDone={onSplitDone} />
    </div>
  )
}

function GroupHeader({ group }: { group: FixGroup }) {
  const state = useStore()
  const view = viewGroup(state, group)
  const instances = [...new Set(view.findings.map((f) => state.instances[f.finding.instanceId]))]
  return (
    <div className="panel section">
      <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <GroupBadge status={view.status} />
        <OriginBadge origin={group.origin} />
        {view.findings[0]?.finding.ruleTitle}
      </h3>
      <dl className="kv">
        <dt>规则</dt>
        <dd><code>{view.findings[0]?.finding.ruleId}</code></dd>
        <dt>自动签名</dt>
        <dd>{group.autoSignature
          ? <code>{group.autoSignature}</code>
          : <span>无（人工组，新命中不会自动并入）</span>}</dd>
        <dt>组件实例</dt>
        <dd>
          {instances.map((inst) => (
            <div key={inst.id} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
              <span><b>{inst.component}</b> · {inst.label}</span>
              <code>{inst.version}</code>
              <VersionChanger instanceId={inst.id} current={inst.version} />
            </div>
          ))}
        </dd>
        <dt>覆盖范围</dt>
        <dd>{view.counts.total} 条页面证据 / {view.pages.length} 个页面：
          通过 {view.counts.verified} · 未通过 {view.counts.failed} ·
          过期 {view.counts.stale} · 未验证 {view.counts.open}
        </dd>
      </dl>
      {view.status === 'partial' && (
        <p className="stale-note" style={{ marginTop: 8 }}>
          ⚠ 仅部分页面通过：未通过、过期与未验证的页面保持开放，整组不能关闭。
        </p>
      )}
      {view.status === 'resolved' && (
        <p style={{ marginTop: 8, color: 'var(--ok)', fontSize: 12 }}>
          ✓ 全部页面证据均在当前候选与当前现场下验证通过，可以关闭这组问题。
        </p>
      )}
    </div>
  )
}

function VersionChanger({ instanceId, current }: { instanceId: string; current: string }) {
  const [editing, setEditing] = useState(false)
  const [version, setVersion] = useState(current)
  if (!editing) {
    return <button className="btn small" onClick={() => { setVersion(current); setEditing(true) }}>换版</button>
  }
  return (
    <span className="row-actions">
      <input
        aria-label="新版本号"
        value={version}
        style={{ width: 160 }}
        onChange={(e) => setVersion(e.target.value)}
      />
      <button
        className="btn small primary"
        disabled={!version.trim() || version === current}
        onClick={() => { store.changeVersion(instanceId, version.trim()); setEditing(false) }}
      >
        应用换版
      </button>
      <button className="btn small" onClick={() => setEditing(false)}>取消</button>
    </span>
  )
}

function CandidatePanel({ group }: { group: FixGroup }) {
  const state = useStore()
  const [summary, setSummary] = useState('')
  const [version, setVersion] = useState('')
  const [detail, setDetail] = useState('')
  const candidate = group.activeCandidateId ? state.candidates[group.activeCandidateId] : undefined

  function submit() {
    if (!summary.trim() || !version.trim()) return
    store.submitCandidate(group.id, {
      summary: summary.trim(),
      fixVersion: version.trim(),
      detail: detail.trim(),
    })
    setSummary(''); setVersion(''); setDetail('')
  }

  return (
    <div className="panel section">
      <h3>修复候选</h3>
      {candidate ? (
        <div className="candidate-box">
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <b>{candidate.summary}</b>
            <code>{candidate.fixVersion}</code>
          </div>
          {candidate.detail && <p style={{ margin: '6px 0 0', fontSize: 12 }}>{candidate.detail}</p>}
          <p style={{ margin: '6px 0 0', fontSize: 11.5, color: 'var(--muted)' }}>
            提交于 {formatTime(candidate.createdAt)}（{candidate.id}）
          </p>
        </div>
      ) : (
        <p style={{ fontSize: 12, color: 'var(--muted)' }}>
          尚无候选：录入修复说明与版本后，才能逐页验证。
        </p>
      )}
      <details style={{ marginTop: 8 }}>
        <summary className="btn small" style={{ display: 'inline-block' }}>
          {candidate ? '提交新候选（替换当前候选）' : '提交修复候选'}
        </summary>
        <div style={{ marginTop: 8 }}>
          {candidate && (
            <p className="stale-note">
              替换后旧候选下的通过结论只保留为历史快照，全部页面需在新候选下重新验证。
            </p>
          )}
          <div className="field">
            <label>修复说明</label>
            <input value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="例如：icon-only 变体要求必传 ariaLabel" />
          </div>
          <div className="field">
            <label>声称包含修复的代码版本</label>
            <input value={version} onChange={(e) => setVersion(e.target.value)} placeholder="例如 design-system@3.2.0" />
          </div>
          <div className="field">
            <label>细节（可选）</label>
            <textarea value={detail} onChange={(e) => setDetail(e.target.value)} />
          </div>
          <button className="btn primary small" onClick={submit} disabled={!summary.trim() || !version.trim()}>
            提交候选
          </button>
        </div>
      </details>
    </div>
  )
}

function VerifyMatrix({ groupId, onSplitDone }: { groupId: GroupId; onSplitDone: (id: GroupId) => void }) {
  const state = useStore()
  const group = state.groups[groupId]
  if (!group || group.archived) {
    return <div className="panel empty">该修复组不存在或已随合并归档。</div>
  }
  const view = viewGroup(state, group)
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [splitMode, setSplitMode] = useState(false)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [pageVersions, setPageVersions] = useState<Record<string, string>>({})

  function togglePick(id: string) {
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  function doSplit() {
    if (picked.size === 0 || picked.size === group.memberIds.length) return
    const r = store.split(groupId, [...picked])
    setPicked(new Set())
    setSplitMode(false)
    onSplitDone(r.newGroupId)
  }

  return (
    <div className="panel">
      <div className="toolbar-row">
        <h3 style={{ margin: 0, flex: 1 }}>逐页验证矩阵（{view.findings.length}）</h3>
        {!splitMode ? (
          <button className="btn small" onClick={() => setSplitMode(true)} disabled={group.memberIds.length < 2}>
            拆分此组
          </button>
        ) : (
          <>
            <button className="btn small primary" onClick={doSplit}
              disabled={picked.size === 0 || picked.size === group.memberIds.length}>
              将 {picked.size} 条移到新组
            </button>
            <button className="btn small" onClick={() => { setSplitMode(false); setPicked(new Set()) }}>
              取消
            </button>
          </>
        )}
      </div>
      <table className="matrix">
        <thead>
          <tr>
            {splitMode && <th />}
            <th>页面 / 证据</th>
            <th>当前状态</th>
            <th>验证操作</th>
          </tr>
        </thead>
        <tbody>
          {view.findings.map((fv) => {
            const f = fv.finding
            const page = state.pages[f.pageId]
            const history = verificationHistory(state, f.id)
            const pageVersion = pageVersions[f.id] ?? f.codeVersion
            const canVerify = Boolean(group.activeCandidateId)
            return (
              <tr key={f.id}>
                {splitMode && (
                  <td>
                    <input
                      type="checkbox"
                      checked={picked.has(f.id)}
                      onChange={() => togglePick(f.id)}
                      aria-label={`选择 ${page?.name} 的命中进行拆分`}
                    />
                  </td>
                )}
                <td style={{ maxWidth: 320 }}>
                  <b>{page?.name ?? f.pageId}</b>{' '}
                  <span className="mono">{page?.url}</span>
                  <div className="mono" style={{ marginTop: 3 }}>{f.evidence.selector}</div>
                  <div style={{ marginTop: 3, color: 'var(--muted)' }}>{f.evidence.observed}</div>
                  <div className="mono" style={{ marginTop: 3, color: 'var(--muted)' }}>{f.evidence.snippet}</div>
                  <div style={{ marginTop: 3, fontSize: 11.5, color: 'var(--muted)' }}>
                    根因 <code>{f.evidence.rootCauseKey}</code> · 证据 <code>{f.evidence.hash}</code> · 扫描轮次 {f.scanSeq}
                  </div>
                  <RefreshEvidence findingId={f.id} />
                </td>
                <td>
                  <FindingBadge status={fv.status} />
                  {fv.staleReasons.map((r, i) => (
                    <div key={i} className="stale-note">⚠ {r}</div>
                  ))}
                  {history.length > 0 && (
                    <details style={{ marginTop: 6 }}>
                      <summary style={{ fontSize: 11.5, color: 'var(--primary)', cursor: 'pointer' }}>
                        验证快照 × {history.length}
                      </summary>
                      <div className="snapshot-box">
                        {history.map((v) => (
                          <div key={v.id} style={{ marginBottom: 8 }}>
                            <div className="row-actions">
                              <span className={`badge ${v.result === 'pass' ? 'verified' : 'failed'}`}>
                                {v.result === 'pass' ? '通过' : '未通过'}
                              </span>
                              <ValidityBadge validity={snapshotValidity(state, v, group)} />
                              <span className="mono">{formatTime(v.at)}</span>
                            </div>
                            <ul>
                              <li>候选 <code>{v.candidateId}</code>{state.candidates[v.candidateId]?.superseded ? '（已替换）' : ''}</li>
                              <li>验证时页面版本 <code>{v.codeVersion}</code> · 实例版本 <code>{v.instanceVersion}</code></li>
                              <li>针对扫描轮次 {v.scanSeq} · 证据 <code>{v.evidenceHash}</code></li>
                              {v.note && <li>备注：{v.note}</li>}
                            </ul>
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
                </td>
                <td style={{ minWidth: 230 }}>
                  {!canVerify && <div style={{ color: 'var(--muted)', fontSize: 12 }}>提交候选后可验证</div>}
                  {canVerify && (
                    <>
                      <div className="field">
                        <label>验证时页面版本</label>
                        <input
                          value={pageVersion}
                          onChange={(e) => setPageVersions((p) => ({ ...p, [f.id]: e.target.value }))}
                        />
                      </div>
                      <div className="field">
                        <label>备注</label>
                        <input
                          className="note-input"
                          value={notes[f.id] ?? ''}
                          onChange={(e) => setNotes((n) => ({ ...n, [f.id]: e.target.value }))}
                          placeholder="验证发现（可选）"
                        />
                      </div>
                      <div className="row-actions">
                        <button
                          className="btn small pass"
                          onClick={() => store.verify({
                            groupId, findingId: f.id, result: 'pass',
                            note: notes[f.id]?.trim() || undefined,
                            codeVersion: pageVersion.trim() || undefined,
                          })}
                        >
                          通过
                        </button>
                        <button
                          className="btn small fail"
                          onClick={() => store.verify({
                            groupId, findingId: f.id, result: 'fail',
                            note: notes[f.id]?.trim() || undefined,
                            codeVersion: pageVersion.trim() || undefined,
                          })}
                        >
                          未通过
                        </button>
                      </div>
                    </>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function RefreshEvidence({ findingId }: { findingId: string }) {
  const state = useStore()
  const finding = state.findings[findingId]
  const [open, setOpen] = useState(false)
  const [version, setVersion] = useState(finding.codeVersion)
  const [observed, setObserved] = useState(finding.evidence.observed)
  const [snippet, setSnippet] = useState(finding.evidence.snippet)
  const [rootKey, setRootKey] = useState(finding.evidence.rootCauseKey)

  function refresh() {
    const r = store.refresh({
      findingId,
      codeVersion: version.trim(),
      evidence: {
        selector: finding.evidence.selector,
        snippet, observed, rootCauseKey: rootKey.trim(),
      },
    })
    if (r.changed) setOpen(false)
  }

  if (!open) {
    return <button className="btn small" style={{ marginTop: 6 }} onClick={() => {
      setVersion(finding.codeVersion)
      setObserved(finding.evidence.observed)
      setSnippet(finding.evidence.snippet)
      setRootKey(finding.evidence.rootCauseKey)
      setOpen(true)
    }}>
      重新扫描 / 刷新证据
    </button>
  }

  return (
    <div className="snapshot-box">
      <div className="field">
        <label>重新扫描时的页面代码版本</label>
        <input value={version} onChange={(e) => setVersion(e.target.value)} />
      </div>
      <div className="field">
        <label>观察到的现象</label>
        <input value={observed} onChange={(e) => setObserved(e.target.value)} />
      </div>
      <div className="field">
        <label>代码片段</label>
        <textarea value={snippet} onChange={(e) => setSnippet(e.target.value)} />
      </div>
      <div className="field">
        <label>根因键（变化时不会自动改组，需人工判断是否拆分）</label>
        <input value={rootKey} onChange={(e) => setRootKey(e.target.value)} />
      </div>
      <div className="row-actions">
        <button className="btn small primary" onClick={refresh}>提交刷新</button>
        <button className="btn small" onClick={() => setOpen(false)}>取消</button>
      </div>
    </div>
  )
}
