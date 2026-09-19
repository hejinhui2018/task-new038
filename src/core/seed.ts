import {
  addInstance,
  addPage,
  changeInstanceVersion,
  createInitialState,
  ingestFinding,
  recordVerification,
  refreshEvidence,
  submitCandidate,
} from './commands'
import type { AppState } from './types'

/**
 * 演示种子：Button 组件缺少可访问名称（button-name）在多个页面命中，
 * 另有 Dialog 角色误用组；含一次候选、部分页面验证与一次实例换版。
 * 时间戳固定，保证每次构建的初始数据一致。
 */
export function buildSeedState(): AppState {
  let s = createInitialState()
  s.seq = 0
  const base = 1_700_000_000_000
  const t = (i: number) => base + i * 60_000

  const pageNames: Array<[string, string]> = [
    ['首页', '/home'],
    ['商品详情', '/product/42'],
    ['搜索结果', '/search?q=chair'],
    ['购物车', '/cart'],
    ['结算', '/checkout'],
    ['订单列表', '/orders'],
    ['个人中心', '/account'],
    ['帮助中心', '/help'],
    ['营销活动页', '/promo/summer'],
    ['消息通知', '/notifications'],
    ['登录', '/login'],
    ['设置', '/settings'],
  ]
  const pageIds: string[] = []
  for (const [name, url] of pageNames) {
    const r = addPage(s, { name, url })
    s = r.state
    pageIds.push(r.pageId)
  }

  const btn = addInstance(s, {
    component: 'Button',
    label: '主操作按钮（icon-only 变体）',
    version: 'design-system@3.1.0',
  })
  s = btn.state
  const buttonId = btn.instanceId

  const dlg = addInstance(s, {
    component: 'Dialog',
    label: '确认弹窗',
    version: 'design-system@3.1.0',
  })
  s = dlg.state
  const dialogId = dlg.instanceId

  // 12 个页面的 button-name 命中：同一组件、同一规则、同一根因键 → 自动归为一组
  pageIds.forEach((pageId, i) => {
    const r = ingestFinding(
      s,
      {
        pageId,
        instanceId: buttonId,
        ruleId: 'button-name',
        ruleTitle: '按钮缺少可访问名称',
        codeVersion: 'app@2026.09.01',
        evidence: {
          selector: `.btn-primary.icon-only[data-track="cta-${i + 1}"]`,
          snippet: '<button class="btn-primary icon-only"><svg>...</svg></button>',
          observed: 'button 元素没有文本内容，也没有 aria-label / aria-labelledby',
          rootCauseKey: 'icon-button-missing-name-prop',
        },
      },
      t(i + 1),
    )
    s = r.state
  })

  // Dialog 组：role 误用，3 个页面
  const dialogPages = [pageIds[0], pageIds[4], pageIds[6]]
  dialogPages.forEach((pageId, i) => {
    const r = ingestFinding(
      s,
      {
        pageId,
        instanceId: dialogId,
        ruleId: 'aria-allowed-role',
        ruleTitle: '元素使用了不允许的 ARIA 角色',
        codeVersion: 'app@2026.09.01',
        evidence: {
          selector: `.modal-wrap[data-track="confirm-${i + 1}"]`,
          snippet: '<div class="modal-wrap" role="dialog-button">...</div>',
          observed: 'role="dialog-button" 不是合法的 ARIA role',
          rootCauseKey: 'invalid-role-token',
        },
      },
      t(20 + i),
    )
    s = r.state
  })

  // 找一个组来演示候选与部分通过
  const buttonGroupId = Object.values(s.groups)
    .filter((g) => g.origin === 'auto')
    .sort((a, b) => (a.id < b.id ? -1 : 1))[0].id

  // 组件先换版到修复版本，再逐页验证
  s = changeInstanceVersion(s, buttonId, 'design-system@3.2.0', t(40))

  const c = submitCandidate(
    s,
    buttonGroupId,
    {
      summary: '为 icon-only Button 增加必填的 ariaLabel 属性',
      detail: '在 Button 组件内部把 ariaLabel 透传到 <button aria-label>，并在 TS 类型上要求 icon-only 变体必填。',
      fixVersion: 'design-system@3.2.0',
    },
    t(41),
  )
  s = c.state

  // 前三个页面在新版本验证通过，第四个未通过 —— 部分通过（未通过项不跟着关闭）
  const members = [...s.groups[buttonGroupId].memberIds]
  const passPages = members.slice(0, 3)
  for (const fid of passPages) {
    s = recordVerification(
      s,
      {
        groupId: buttonGroupId,
        findingId: fid,
        result: 'pass',
        note: '升级 3.2.0 后 axe 不再报 button-name',
        codeVersion: 'app@2026.09.10',
      },
      t(42),
    ).state
  }
  s = recordVerification(
    s,
    {
      groupId: buttonGroupId,
      findingId: members[3],
      result: 'fail',
      note: '该页直接写了原生 <button>，没有走组件，仍缺名称',
      codeVersion: 'app@2026.09.10',
    },
    t(43),
  ).state

  // 第五个页面曾验证通过，随后页面证据被重新扫描刷新 —— 旧通过快照过期，需重新确认
  s = recordVerification(
    s,
    {
      groupId: buttonGroupId,
      findingId: members[4],
      result: 'pass',
      note: '初验通过',
      codeVersion: 'app@2026.09.10',
    },
    t(44),
  ).state
  s = refreshEvidence(
    s,
    {
      findingId: members[4],
      codeVersion: 'app@2026.09.12',
      evidence: {
        selector: s.findings[members[4]].evidence.selector,
        snippet: '<button data-track="cta-5" class="btn-primary icon-only" aria-label=""><svg>...</svg></button>',
        observed: '重新扫描发现 aria-label 被显式传成空字符串，accessible name 仍为空',
        rootCauseKey: 'icon-button-missing-name-prop',
      },
    },
    t(50),
  ).state

  return s
}
