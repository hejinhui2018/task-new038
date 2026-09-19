import { describe, expect, it } from 'vitest'
import {
  addPage,
  ingestFinding,
  mergeGroups,
  recordVerification,
  splitGroup,
  submitCandidate,
} from '../core/commands'
import type { AppState } from '../core/types'
import { activeGroups, viewGroup } from '../core/selectors'
import { buildScenario } from './scenario'

function addPageInline(state: AppState, name: string, url: string) {
  return addPage(state, { name, url })
}
function ingestInline(
  state: AppState,
  pageId: string,
  instanceId: string,
  ruleId: string,
  rootCauseKey: string,
) {
  return ingestFinding(state, {
    pageId,
    instanceId,
    ruleId,
    ruleTitle: '按钮缺少可访问名称',
    codeVersion: 'app@1.0.0',
    evidence: {
      selector: `button.${rootCauseKey}`,
      snippet: '<button/>',
      observed: '空名称',
      rootCauseKey,
    },
  })
}

describe('拆分与合并修复组', () => {
  it('拆分：移走的命中进入新人工组，不携带候选，需重新验证', () => {
    const sc = buildScenario({ pageCount: 4 })
    let s = submitCandidate(sc.state, sc.groupId, {
      summary: '修复', detail: '', fixVersion: 'ds@2.0.0',
    }).state
    for (const fid of sc.findingIds) {
      s = recordVerification(s, {
        groupId: sc.groupId, findingId: fid, result: 'pass', codeVersion: 'app@2.0.0',
      }).state
    }

    const out = splitGroup(s, sc.groupId, [sc.findingIds[2], sc.findingIds[3]])
    s = out.state
    expect(s.groups[sc.groupId].memberIds).toEqual([sc.findingIds[0], sc.findingIds[1]])
    const ng = s.groups[out.newGroupId]
    expect(ng.memberIds).toEqual([sc.findingIds[2], sc.findingIds[3]])
    expect(ng.origin).toBe('split')
    expect(ng.activeCandidateId).toBeNull()
    expect(viewGroup(s, ng).status).toBe('open')
    // 旧组仍全部通过
    expect(viewGroup(s, s.groups[sc.groupId]).status).toBe('resolved')
    // 影响记录说明了页面范围
    const entry = s.impactLog.at(-1)!
    expect(entry.kind).toBe('split')
    expect(entry.pageIds).toHaveLength(2)
  })

  it('不能拆空整组，也不能拆分零条', () => {
    const sc = buildScenario({ pageCount: 3 })
    expect(() => splitGroup(sc.state, sc.groupId, [])).toThrow()
    expect(() => splitGroup(sc.state, sc.groupId, sc.findingIds)).toThrow()
  })

  it('合并：旧组归档，新人工组无候选无自动签名', () => {
    const a = buildScenario({ pageCount: 2, rootCauseKey: 'cause-a' })
    // 加一个不同根因的第二个组
    const extraPage = addPageInline(a.state, '独立页', '/x')
    let s = extraPage.state
    const r = ingestInline(s, extraPage.pageId, a.instanceId, 'button-name', 'cause-b')
    s = r.state
    const secondGroup = r.groupId

    const out = mergeGroups(s, [a.groupId, secondGroup])
    s = out.state
    expect(s.groups[a.groupId].archived).toBe(true)
    expect(s.groups[secondGroup].archived).toBe(true)
    const merged = s.groups[out.newGroupId]
    expect(merged.archived).toBe(false)
    expect(merged.origin).toBe('merged')
    expect(merged.autoSignature).toBeNull()
    expect(merged.memberIds).toHaveLength(3)
    expect(merged.activeCandidateId).toBeNull()
    expect(activeGroups(s)).toHaveLength(1)

    // 同签名新命中不会自动进入合并组，而是新建自动组
    const p2 = addPageInline(s, '再来一页', '/y')
    s = p2.state
    const r2 = ingestInline(s, p2.pageId, a.instanceId, 'button-name', 'cause-a')
    s = r2.state
    expect(r2.groupId).not.toBe(out.newGroupId)
    expect(activeGroups(s)).toHaveLength(2)
  })

  it('合并至少需要两个组', () => {
    const sc = buildScenario()
    expect(() => mergeGroups(sc.state, [sc.groupId])).toThrow()
  })
})
