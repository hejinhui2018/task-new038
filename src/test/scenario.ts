import {
  addInstance,
  addPage,
  createInitialState,
  ingestFinding,
} from '../core/commands'
import type { AppState, FindingId, GroupId, InstanceId, PageId } from '../core/types'

export interface Scenario {
  state: AppState
  pageIds: PageId[]
  instanceId: InstanceId
  findingIds: FindingId[]
  groupId: GroupId
}

export interface ScenarioOptions {
  pageCount?: number
  ruleId?: string
  component?: string
  rootCauseKey?: string
  codeVersion?: string
  instanceVersion?: string
}

/** 构造“同一组件根因 × N 个页面”的标准场景 */
export function buildScenario(opts: ScenarioOptions = {}): Scenario {
  const {
    pageCount = 4,
    ruleId = 'button-name',
    component = 'Button',
    rootCauseKey = 'icon-button-missing-name-prop',
    codeVersion = 'app@1.0.0',
    instanceVersion = 'ds@1.0.0',
  } = opts

  let state = createInitialState()
  const pageIds: PageId[] = []
  for (let i = 0; i < pageCount; i++) {
    const r = addPage(state, { name: `页面${i + 1}`, url: `/p${i + 1}` })
    state = r.state
    pageIds.push(r.pageId)
  }
  const ir = addInstance(state, {
    component,
    label: `${component} 实例`,
    version: instanceVersion,
  })
  state = ir.state

  const findingIds: FindingId[] = []
  let groupId = ''
  let clock = 1_000
  for (const pageId of pageIds) {
    const r = ingestFinding(
      state,
      {
        pageId,
        instanceId: ir.instanceId,
        ruleId,
        ruleTitle: '按钮缺少可访问名称',
        codeVersion,
        evidence: {
          selector: `button[data-page="${pageId}"]`,
          snippet: '<button><svg/></button>',
          observed: 'accessible name 为空',
          rootCauseKey,
        },
      },
      clock++,
    )
    state = r.state
    groupId = r.groupId
    findingIds.push(r.findingId)
  }

  return { state, pageIds, instanceId: ir.instanceId, findingIds, groupId }
}
