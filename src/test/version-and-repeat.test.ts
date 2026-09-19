import { describe, expect, it } from 'vitest'
import {
  changeInstanceVersion,
  recordVerification,
  refreshEvidence,
  submitCandidate,
} from '../core/commands'
import { snapshotValidity, viewFinding, viewGroup } from '../core/selectors'
import { buildScenario } from './scenario'

function passAll(s0: ReturnType<typeof buildScenario>) {
  let s = submitCandidate(s0.state, s0.groupId, {
    summary: '修复', detail: '', fixVersion: 'ds@2.0.0',
  }).state
  for (const fid of s0.findingIds) {
    s = recordVerification(s, {
      groupId: s0.groupId, findingId: fid, result: 'pass', codeVersion: 'app@2.0.0',
    }).state
  }
  return s
}

describe('版本变化', () => {
  it('实例换版后：该实例所有页面通过结论变为过期，组退回部分通过', () => {
    const sc = buildScenario({ pageCount: 4, instanceVersion: 'ds@1.0.0' })
    let s = passAll(sc)
    expect(viewGroup(s, s.groups[sc.groupId]).status).toBe('resolved')

    s = changeInstanceVersion(s, sc.instanceId, 'ds@2.1.0')

    const view = viewGroup(s, s.groups[sc.groupId])
    expect(view.counts.stale).toBe(4)
    expect(view.counts.verified).toBe(0)
    expect(view.status).toBe('fixing')
    const entry = s.impactLog.at(-1)!
    expect(entry.kind).toBe('instance-version')
    expect(entry.findingIds).toHaveLength(4)
  })

  it('换版后重新验证通过，状态恢复 verified；不验证的其他页面仍过期', () => {
    const sc = buildScenario({ pageCount: 3 })
    let s = passAll(sc)
    s = changeInstanceVersion(s, sc.instanceId, 'ds@2.1.0')

    s = recordVerification(s, {
      groupId: sc.groupId, findingId: sc.findingIds[0], result: 'pass', codeVersion: 'app@2.0.0',
    }).state

    const view = viewGroup(s, s.groups[sc.groupId])
    expect(view.counts.verified).toBe(1)
    expect(view.counts.stale).toBe(2)
    expect(view.status).toBe('partial')
  })

  it('页面证据以相同指纹相同版本重复刷新：无变化、不产生影响记录、轮次不增', () => {
    const sc = buildScenario({ pageCount: 2 })
    const fid = sc.findingIds[0]
    const before = sc.state
    const r = refreshEvidence(before, {
      findingId: fid,
      codeVersion: before.findings[fid].codeVersion,
      evidence: {
        selector: before.findings[fid].evidence.selector,
        snippet: before.findings[fid].evidence.snippet,
        observed: before.findings[fid].evidence.observed,
        rootCauseKey: before.findings[fid].evidence.rootCauseKey,
      },
    })
    expect(r.changed).toBe(false)
    expect(r.state).toBe(before)
  })

  it('页面版本变化即令旧验证快照过期，仅影响该页面这一条证据', () => {
    const sc = buildScenario({ pageCount: 3 })
    let s = passAll(sc)
    const target = sc.findingIds[0]

    const f = s.findings[target]
    s = refreshEvidence(s, {
      findingId: target,
      codeVersion: 'app@2.1.0',
      evidence: {
        selector: f.evidence.selector,
        snippet: f.evidence.snippet,
        observed: f.evidence.observed,
        rootCauseKey: f.evidence.rootCauseKey,
      },
    }).state

    expect(viewFinding(s, s.findings[target]).status).toBe('stale')
    expect(viewFinding(s, s.findings[sc.findingIds[1]]).status).toBe('verified')
    expect(viewFinding(s, s.findings[sc.findingIds[2]]).status).toBe('verified')
    const view = viewGroup(s, s.groups[sc.groupId])
    expect(view.status).toBe('partial')
  })

  it('证据指纹变化令快照过期，历史快照仍可查看并标记 stale-evidence', () => {
    const sc = buildScenario({ pageCount: 1 })
    let s = passAll(sc)
    const target = sc.findingIds[0]
    const oldSnap = s.verifications.find((v) => v.findingId === target)!

    s = refreshEvidence(s, {
      findingId: target,
      codeVersion: 'app@2.0.0',
      evidence: {
        selector: 'button[data-page="/p1"]',
        snippet: '<button class="x"><svg/></button>',
        observed: '名称仍为空，DOM 结构变化',
        rootCauseKey: 'icon-button-missing-name-prop',
      },
    }).state

    expect(snapshotValidity(s, oldSnap)).toBe('stale-evidence')
    expect(viewFinding(s, s.findings[target]).status).toBe('stale')
  })

  it('实例版本相同的换版请求不产生新状态', () => {
    const sc = buildScenario({ pageCount: 1 })
    const out = changeInstanceVersion(sc.state, sc.instanceId, 'ds@1.0.0')
    expect(out).toBe(sc.state)
  })
})

describe('重复验证', () => {
  it('同候选、同现场、同结论重复验证：幂等，不新增快照', () => {
    const sc = buildScenario({ pageCount: 1 })
    let s = submitCandidate(sc.state, sc.groupId, {
      summary: '修复', detail: '', fixVersion: 'ds@2.0.0',
    }).state
    const input = {
      groupId: sc.groupId, findingId: sc.findingIds[0], result: 'pass' as const, codeVersion: 'app@2.0.0',
    }
    s = recordVerification(s, input).state
    const countAfterFirst = s.verifications.length

    const dup = recordVerification(s, input)
    expect(dup.duplicated).toBe(true)
    expect(dup.state.verifications.length).toBe(countAfterFirst)
    // 但会产生一条“重复验证已忽略”的影响记录
    expect(dup.state.impactLog.at(-1)?.kind).toBe('duplicate-verification')
  })

  it('结论不同不算重复：fail 覆盖最近 pass 产生新快照并判回归', () => {
    const sc = buildScenario({ pageCount: 1 })
    let s = submitCandidate(sc.state, sc.groupId, {
      summary: '修复', detail: '', fixVersion: 'ds@2.0.0',
    }).state
    s = recordVerification(s, {
      groupId: sc.groupId, findingId: sc.findingIds[0], result: 'pass', codeVersion: 'app@2.0.0',
    }).state
    const out = recordVerification(s, {
      groupId: sc.groupId, findingId: sc.findingIds[0], result: 'fail', codeVersion: 'app@2.0.0',
    })
    expect(out.duplicated).toBe(false)
    expect(out.regression).toBe(true)
    expect(out.state.verifications).toHaveLength(2)
  })

  it('证据已刷新后重复旧结论：现场不同，不判重复，需重新给出结论', () => {
    const sc = buildScenario({ pageCount: 1 })
    let s = submitCandidate(sc.state, sc.groupId, {
      summary: '修复', detail: '', fixVersion: 'ds@2.0.0',
    }).state
    s = recordVerification(s, {
      groupId: sc.groupId, findingId: sc.findingIds[0], result: 'pass', codeVersion: 'app@2.0.0',
    }).state
    const f = s.findings[sc.findingIds[0]]
    s = refreshEvidence(s, {
      findingId: f.id,
      codeVersion: 'app@2.0.0',
      evidence: {
        selector: f.evidence.selector,
        snippet: '<button disabled><svg/></button>',
        observed: '现场变化',
        rootCauseKey: f.evidence.rootCauseKey,
      },
    }).state
    const out = recordVerification(s, {
      groupId: sc.groupId, findingId: f.id, result: 'pass', codeVersion: 'app@2.0.0',
    })
    expect(out.duplicated).toBe(false)
    expect(out.regression).toBe(false)
    expect(out.state.verifications).toHaveLength(2)
    expect(viewFinding(out.state, out.state.findings[f.id]).status).toBe('verified')
  })
})
