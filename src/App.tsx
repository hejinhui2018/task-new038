import { useEffect, useMemo, useState } from 'react'
import { allGroupViews } from './core/selectors'
import { buildSeedState } from './core/seed'
import { clearStorage, store, useStore } from './core/store'
import { GroupDetail } from './ui/GroupDetail'
import { GroupList } from './ui/GroupList'
import { ImpactLog } from './ui/ImpactLog'
import { IngestDialog } from './ui/IngestDialog'

export default function App() {
  const state = useStore()
  const groups = allGroupViews(state)
  const [selectedId, setSelectedId] = useState<string | null>(groups[0]?.group.id ?? null)
  const [showIngest, setShowIngest] = useState(false)
  const [mergeMode, setMergeMode] = useState(false)
  const [mergeSelection, setMergeSelection] = useState<string[]>([])
  const [restoredAt] = useState<number | null>(store.restoredAt)
  const [showRestoredBanner, setShowRestoredBanner] = useState(restoredAt !== null)
  const [, forceTick] = useState(0)

  // 撤销/重做按钮可用性需要随状态刷新
  useEffect(() => {
    const unsub = store.subscribe(() => forceTick((n) => n + 1))
    return unsub
  }, [])

  // Ctrl/Cmd+Z 撤销，Ctrl/Cmd+Shift+Z 重做
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const mod = e.ctrlKey || e.metaKey
      if (!mod || e.key.toLowerCase() !== 'z') return
      const target = e.target as HTMLElement | null
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return
      e.preventDefault()
      if (e.shiftKey) store.redo(); else store.undo()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // 选中组被归档（合并）时自动切到剩余第一个
  useEffect(() => {
    if (selectedId && state.groups[selectedId]?.archived) {
      setSelectedId(groups[0]?.group.id ?? null)
    }
  }, [state, selectedId, groups])

  const selected = selectedId && state.groups[selectedId] && !state.groups[selectedId].archived
    ? selectedId
    : groups[0]?.group.id ?? null

  const totals = useMemo(() => {
    let pages = new Set<string>()
    for (const g of groups) for (const f of g.findings) pages.add(f.finding.pageId)
    return {
      pages: pages.size,
      findings: groups.reduce((n, g) => n + g.counts.total, 0),
      verified: groups.reduce((n, g) => n + g.counts.verified, 0),
    }
  }, [groups])

  function toggleMerge(id: string) {
    setMergeSelection((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    )
  }

  function doMerge() {
    if (mergeSelection.length < 2) return
    const r = store.merge(mergeSelection)
    setMergeMode(false)
    setMergeSelection([])
    setSelectedId(r.newGroupId)
  }

  function doReset() {
    if (!window.confirm('确定一键复位？全部录入、归并、候选、验证快照与本地保存的状态都会被清空。')) return
    clearStorage()
    store.reset()
    setSelectedId(null)
    setShowRestoredBanner(false)
  }

  function loadSeed() {
    if (Object.keys(state.findings).length > 0) {
      if (!window.confirm('载入演示数据会替换当前工作台全部内容，确定继续？')) return
    }
    clearStorage()
    store.replaceState(buildSeedState())
    const first = allGroupViews(store.getState())[0]?.group.id ?? null
    setSelectedId(first)
    setShowRestoredBanner(false)
  }

  return (
    <div className="app">
      <div className="topbar">
        <div>
          <h1>AccessReview 问题归并与修复验证台</h1>
          <div className="subtitle">同一组件根因归为一组 · 页面证据独立 · 部分通过不连坐关闭 · 全部本地运行</div>
        </div>
        <div className="spacer" />
        <button className="btn" onClick={() => store.undo()} disabled={!store.canUndo()} title="Ctrl/⌘+Z">↶ 撤销</button>
        <button className="btn" onClick={() => store.redo()} disabled={!store.canRedo()} title="Ctrl/⌘+Shift+Z">↷ 重做</button>
        <button className="btn" onClick={() => setShowIngest(true)}>＋ 录入扫描命中</button>
        {!mergeMode ? (
          <button className="btn" onClick={() => { setMergeMode(true); setMergeSelection(selected ? [selected] : []) }}>
            合并组…
          </button>
        ) : (
          <>
            <button className="btn primary" onClick={doMerge} disabled={mergeSelection.length < 2}>
              合并选中的 {mergeSelection.length} 组
            </button>
            <button className="btn" onClick={() => { setMergeMode(false); setMergeSelection([]) }}>取消</button>
          </>
        )}
        <button className="btn" onClick={loadSeed}>载入演示数据</button>
        <button className="btn danger" onClick={doReset}>一键复位</button>
      </div>

      {showRestoredBanner && restoredAt && (
        <div className="banner">
          <span>
            已从浏览器本地存储恢复工作台（保存于 {new Date(restoredAt).toLocaleString()}），
            撤销历史不跨刷新保留。
          </span>
          <button className="btn small" onClick={() => setShowRestoredBanner(false)}>知道了</button>
        </div>
      )}

      <div className="layout">
        <GroupList
          selectedId={selected}
          onSelect={setSelectedId}
          mergeMode={mergeMode}
          mergeSelection={mergeSelection}
          onToggleMerge={toggleMerge}
        />
        {selected ? (
          <GroupDetail groupId={selected} onSplitDone={(id) => setSelectedId(id)} />
        ) : (
          <div className="panel empty">
            <p>还没有修复组。</p>
            <p>点击「录入扫描命中」添加扫描结果，或「载入演示数据」快速体验。</p>
          </div>
        )}
        <ImpactLog />
      </div>

      <div className="subtitle" style={{ padding: '0 20px 14px', textAlign: 'right' }}>
        共 {totals.pages} 个页面 · {totals.findings} 条页面证据 · 当前有效通过 {totals.verified} 条
      </div>

      {showIngest && (
        <IngestDialog
          onClose={() => setShowIngest(false)}
          onIngested={(groupId) => {
            setShowIngest(false)
            setSelectedId(groupId)
          }}
        />
      )}
    </div>
  )
}
