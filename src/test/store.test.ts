import { beforeEach, describe, expect, it } from 'vitest'
import { buildSeedState } from '../core/seed'
import { clearStorage, createStore, loadState, type ReviewStore } from '../core/store'
import { viewGroup } from '../core/selectors'

describe('撤销 / 重做', () => {
  let store: ReviewStore
  beforeEach(() => {
    clearStorage()
    store = createStore()
  })

  it('操作可逐步撤销并重做，结论状态随之回退/前进', () => {
    const seed = buildSeedState()
    store.replaceState(seed)
    const groupId = Object.keys(seed.groups)[0]
    const beforeCounts = viewGroup(store.getState(), store.getState().groups[groupId]).counts

    // 再给一条未验证页面记录未通过
    const openFinding = viewGroup(store.getState(), store.getState().groups[groupId]).findings.find(
      (f) => f.status === 'open',
    )!
    store.verify({
      groupId,
      findingId: openFinding.finding.id,
      result: 'fail',
      codeVersion: 'app@2026.09.10',
    })
    expect(viewGroup(store.getState(), store.getState().groups[groupId]).counts.failed)
      .toBe(beforeCounts.failed + 1)
    expect(store.canUndo()).toBe(true)

    store.undo()
    const undone = viewGroup(store.getState(), store.getState().groups[groupId])
    expect(undone.counts.failed).toBe(beforeCounts.failed)
    expect(undone.counts.verified).toBe(beforeCounts.verified)

    store.redo()
    expect(viewGroup(store.getState(), store.getState().groups[groupId]).counts.failed)
      .toBe(beforeCounts.failed + 1)
  })

  it('撤销后做新操作会清空重做分支', () => {
    store.replaceState(buildSeedState())
    expect(store.canUndo()).toBe(false)
    // 录入新页面 + 命中
    const pid = store.addPage({ name: '临时页', url: '/tmp' })
    const instId = Object.keys(store.getState().instances)[0]
    store.ingest({
      pageId: pid,
      instanceId: instId,
      ruleId: 'button-name',
      ruleTitle: '按钮缺少可访问名称',
      codeVersion: 'app@x',
      evidence: {
        selector: '.tmp', snippet: '', observed: '空', rootCauseKey: 'icon-button-missing-name-prop',
      },
    })
    store.undo()
    expect(store.canRedo()).toBe(true)

    store.reset()
    expect(store.canRedo()).toBe(false)
    expect(store.canUndo()).toBe(false)
    expect(Object.keys(store.getState().groups)).toHaveLength(0)
    expect(store.getState().impactLog.at(-1)?.kind).toBe('reset')
  })

  it('一键复位不影响随后全新操作的撤销栈', () => {
    store.replaceState(buildSeedState())
    store.reset()
    const pid = store.addPage({ name: '新页', url: '/n' }).toString()
    void pid
    expect(store.canUndo()).toBe(true)
    store.undo()
    expect(Object.keys(store.getState().pages)).toHaveLength(0)
  })
})

describe('刷新恢复（localStorage 持久化）', () => {
  beforeEach(() => clearStorage())

  it('每次提交都持久化，重新加载后恢复全部数据', () => {
    const s1 = createStore()
    s1.replaceState(buildSeedState())
    // replaceState 也会持久化
    const loaded = loadState()
    expect(loaded.savedAt).not.toBeNull()
    expect(Object.keys(loaded.state.findings).length).toBe(
      Object.keys(buildSeedState().findings).length,
    )

    const s2 = createStore()
    const views = Object.values(s2.getState().groups).map((g) => viewGroup(s2.getState(), g))
    expect(views.some((v) => v.status === 'partial')).toBe(true)
  })

  it('损坏的存储被安全忽略，回到空工作台', () => {
    localStorage.setItem('access-review:state:v1', '{not-json')
    const s = createStore()
    expect(Object.keys(s.getState().groups)).toHaveLength(0)
  })

  it('撤销/重做后存储的是当前状态', () => {
    const s = createStore()
    s.replaceState(buildSeedState())
    const countBefore = Object.keys(s.getState().pages).length
    s.addPage({ name: '多余页', url: '/extra' })
    expect(Object.keys(loadState().state.pages)).toHaveLength(countBefore + 1)
    s.undo()
    expect(Object.keys(loadState().state.pages)).toHaveLength(countBefore)
  })
})
