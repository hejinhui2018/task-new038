import { describe, expect, it } from 'vitest'
import {
  createInitialState,
  addPage,
  addInstance,
  ingestFinding,
  refreshEvidence as __refresh,
  splitGroup as __split,
} from '../core/commands'
import { autoSignature } from '../core/grouping'
import { activeGroups, viewGroup } from '../core/selectors'
import { buildScenario } from './scenario'

describe('自动归并稳定性', () => {
  it('同组件 + 同规则 + 同根因键的多条页面命中归入同一修复组', () => {
    const s = buildScenario({ pageCount: 12 })
    const groups = activeGroups(s.state)
    expect(groups).toHaveLength(1)
    expect(groups[0].memberIds).toHaveLength(12)
    expect(groups[0].origin).toBe('auto')
    expect(groups[0].autoSignature).toBe(autoSignature('button-name', 'Button', 'icon-button-missing-name-prop'))
  })

  it('不同根因键即使同组件同规则也不会归并', () => {
    let s = buildScenario({ pageCount: 2, rootCauseKey: 'cause-a' }).state
    // 再加一条同组件同规则但根因不同的命中
    const extraPage = addPage(s, { name: '额外页', url: '/x' })
    s = extraPage.state
    const instId = Object.keys(s.instances)[0]
    const r = ingestFinding(s, {
      pageId: extraPage.pageId,
      instanceId: instId,
      ruleId: 'button-name',
      ruleTitle: '按钮缺少可访问名称',
      codeVersion: 'app@1.0.0',
      evidence: {
        selector: 'button.x',
        snippet: '<button/>',
        observed: '其他现象',
        rootCauseKey: 'cause-b',
      },
    })
    s = r.state
    const groups = activeGroups(s)
    expect(groups).toHaveLength(2)
    expect(r.groupCreated).toBe(true)
  })

  it('扫描录入顺序变化产生完全一致的归并结果（确定性）', () => {
    const orderA = ['p1', 'p2', 'p3', 'p4']
    const orderB = ['p3', 'p1', 'p4', 'p2']

    function run(order: string[]) {
      let s = createInitialState()
      const inst = addInstance(s, { component: 'Button', label: 'b', version: 'v1' })
      s = inst.state
      const pageIdByName: Record<string, string> = {}
      for (const name of order) {
        const p = addPage(s, { name, url: `/${name}` })
        s = p.state
        pageIdByName[name] = p.pageId
      }
      const memberToPage: Record<string, string> = {}
      for (const name of order) {
        const r = ingestFinding(s, {
          pageId: pageIdByName[name],
          instanceId: inst.instanceId,
          ruleId: 'button-name',
          ruleTitle: '缺名称',
          codeVersion: 'v1',
          evidence: {
            selector: `.${name}`,
            snippet: '<button/>',
            observed: '空名称',
            rootCauseKey: 'same-cause',
          },
        })
        s = r.state
        memberToPage[r.findingId] = name
      }
      const g = activeGroups(s)[0]
      return {
        groupId: g.id,
        pages: g.memberIds
          .map((fid) => s.findings[fid].pageId)
          .map((pid) => s.pages[pid].name)
          .sort(),
      }
    }

    const a = run(orderA)
    const b = run(orderB)
    // 组 id 稳定（首个组永远是 grp_<同一序号>），成员覆盖相同
    expect(a.groupId).toBe(b.groupId)
    expect(a.pages).toEqual(b.pages)
  })

  it('新命中只进入最早的自动组，不会进入人工拆分/合并组', () => {
    const s0 = buildScenario({ pageCount: 3 })
    // 拆出一个新组
    const split = __split(s0.state, s0.groupId, [s0.findingIds[2]])
    let s = split.state
    const newPage = addPage(s, { name: '新页面', url: '/new' })
    s = newPage.state
    const r = ingestFinding(s, {
      pageId: newPage.pageId,
      instanceId: s0.instanceId,
      ruleId: 'button-name',
      ruleTitle: '按钮缺少可访问名称',
      codeVersion: 'app@1.0.0',
      evidence: {
        selector: 'button.new',
        snippet: '<button/>',
        observed: '空名称',
        rootCauseKey: 'icon-button-missing-name-prop',
      },
    })
    s = r.state
    // 新命中应进入原自动组，而不是拆分组
    expect(r.groupId).toBe(s0.groupId)
    const splitGroup = s.groups[split.newGroupId]
    expect(splitGroup.memberIds).toHaveLength(1)
    expect(s.groups[s0.groupId].memberIds).toContain(r.findingId)
  })

  it('刷新证据导致根因键变化时归并不变（不自动改组）', () => {
    const s0 = buildScenario({ pageCount: 2 })
    const fid = s0.findingIds[0]
    const r = __refresh(s0.state, {
      findingId: fid,
      codeVersion: 'app@2.0.0',
      evidence: {
        selector: s0.state.findings[fid].evidence.selector,
        snippet: '<button aria-label=""/>',
        observed: 'aria-label 为空字符串',
        rootCauseKey: 'totally-different-cause',
      },
    })
    expect(r.changed).toBe(true)
    const group = r.state.groups[s0.groupId]
    expect(group.memberIds).toContain(fid)
    expect(activeGroups(r.state)).toHaveLength(1)
    // 自动签名仍保留创建时的值，保证后续同签名新命中继续归入
    expect(group.autoSignature).toBe(autoSignature('button-name', 'Button', 'icon-button-missing-name-prop'))
    // 组仍可正常派生
    expect(viewGroup(r.state, group).counts.total).toBe(2)
  })
})
