import { describe, expect, it } from 'vitest'
import { recordVerification, submitCandidate } from '../core/commands'
import { canCloseGroup, viewFinding, viewGroup } from '../core/selectors'
import { buildScenario } from './scenario'

import type { AppState } from '../core/types'

/** 提交候选并按结果逐条验证，返回最新状态 */
function verify(
  state: AppState,
  groupId: string,
  results: Array<{ findingId: string; result: 'pass' | 'fail'; codeVersion?: string }>,
): AppState {
  let s = state
  for (const r of results) {
    s = recordVerification(s, {
      groupId,
      findingId: r.findingId,
      result: r.result,
      codeVersion: r.codeVersion ?? 'app@2.0.0',
    }).state
  }
  return s
}

describe('部分通过：页面结论相互独立', () => {
  it('无候选时所有命中为 open，组为待修复', () => {
    const sc = buildScenario({ pageCount: 4 })
    const view = viewGroup(sc.state, sc.state.groups[sc.groupId])
    expect(view.status).toBe('open')
    expect(view.findings.every((f) => f.status === 'open')).toBe(true)
    expect(canCloseGroup(sc.state, sc.groupId)).toBe(false)
  })

  it('部分页面通过、一个页面未通过时：组为 partial，未通过项保持开放', () => {
    const sc = buildScenario({ pageCount: 4 })
    let s = submitCandidate(sc.state, sc.groupId, {
      summary: '加 ariaLabel', detail: '', fixVersion: 'ds@2.0.0',
    }).state
    s = verify(s, sc.groupId, [
      { findingId: sc.findingIds[0], result: 'pass' },
      { findingId: sc.findingIds[1], result: 'pass' },
      { findingId: sc.findingIds[2], result: 'pass' },
      { findingId: sc.findingIds[3], result: 'fail' },
    ])

    const view = viewGroup(s, s.groups[sc.groupId])
    expect(view.status).toBe('partial')
    expect(view.counts.verified).toBe(3)
    expect(view.counts.failed).toBe(1)
    expect(viewFinding(s, s.findings[sc.findingIds[3]]).status).toBe('failed')
    expect(canCloseGroup(s, sc.groupId)).toBe(false)
  })

  it('其余页面仍未验证时，部分通过不能把未验证项连带关闭', () => {
    const sc = buildScenario({ pageCount: 5 })
    let s = submitCandidate(sc.state, sc.groupId, {
      summary: '加 ariaLabel', detail: '', fixVersion: 'ds@2.0.0',
    }).state
    s = verify(s, sc.groupId, [
      { findingId: sc.findingIds[0], result: 'pass' },
      { findingId: sc.findingIds[1], result: 'pass' },
    ])
    const view = viewGroup(s, s.groups[sc.groupId])
    expect(view.status).toBe('partial')
    expect(view.counts.open).toBe(3)
    expect(canCloseGroup(s, sc.groupId)).toBe(false)
  })

  it('全部页面在当前现场通过才 resolved 且允许关闭', () => {
    const sc = buildScenario({ pageCount: 4 })
    let s = submitCandidate(sc.state, sc.groupId, {
      summary: '加 ariaLabel', detail: '', fixVersion: 'ds@2.0.0',
    }).state
    s = verify(
      s,
      sc.groupId,
      sc.findingIds.map((findingId) => ({ findingId, result: 'pass' as const })),
    )
    const view = viewGroup(s, s.groups[sc.groupId])
    expect(view.status).toBe('resolved')
    expect(canCloseGroup(s, sc.groupId)).toBe(true)
  })

  it('同一证据现场下由 pass 翻转为 fail 判定为回归，重新打开该页面且不影响他页', () => {
    const sc = buildScenario({ pageCount: 3 })
    let s = submitCandidate(sc.state, sc.groupId, {
      summary: '加 ariaLabel', detail: '', fixVersion: 'ds@2.0.0',
    }).state
    s = verify(s, sc.groupId, sc.findingIds.map((findingId) => ({ findingId, result: 'pass' as const })))
    expect(viewGroup(s, s.groups[sc.groupId]).status).toBe('resolved')

    const out = recordVerification(s, {
      groupId: sc.groupId,
      findingId: sc.findingIds[1],
      result: 'fail',
      note: '3.2.1 回退了透传',
      codeVersion: 'app@2.0.0',
    })
    s = out.state
    expect(out.regression).toBe(true)

    const view = viewGroup(s, s.groups[sc.groupId])
    expect(view.status).toBe('partial')
    expect(viewFinding(s, s.findings[sc.findingIds[1]]).status).toBe('failed')
    expect(viewFinding(s, s.findings[sc.findingIds[0]]).status).toBe('verified')
    expect(viewFinding(s, s.findings[sc.findingIds[2]]).status).toBe('verified')
    expect(s.impactLog.at(-1)?.kind).toBe('regression')
  })

  it('替换候选后旧通过不再关闭任何页面，需逐页重新验证', () => {
    const sc = buildScenario({ pageCount: 3 })
    let s = submitCandidate(sc.state, sc.groupId, {
      summary: '候选一', detail: '', fixVersion: 'ds@2.0.0',
    }).state
    s = verify(s, sc.groupId, sc.findingIds.map((findingId) => ({ findingId, result: 'pass' as const })))
    expect(viewGroup(s, s.groups[sc.groupId]).status).toBe('resolved')

    s = submitCandidate(s, sc.groupId, {
      summary: '候选二', detail: '', fixVersion: 'ds@2.1.0',
    }).state

    const view = viewGroup(s, s.groups[sc.groupId])
    expect(view.status).toBe('fixing')
    expect(view.findings.every((f) => f.status === 'open')).toBe(true)
    // 旧验证快照仍保留，但有效性为 superseded
    const oldSnapshots = s.verifications.filter(
      (v) => v.candidateId !== s.groups[sc.groupId].activeCandidateId,
    )
    expect(oldSnapshots.length).toBe(3)
    expect(s.candidates[oldSnapshots[0].candidateId].superseded).toBe(true)
  })
})
