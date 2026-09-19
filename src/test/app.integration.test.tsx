import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { clearStorage, store } from '../core/store'
import { allGroupViews, viewGroup } from '../core/selectors'

beforeEach(() => {
  clearStorage()
  store.reset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('AccessReview 工作台集成', () => {
  it('载入演示数据：看到 12 页面证据的归并组，且部分通过状态正确呈现', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: '载入演示数据' }))

    // 左侧列表：主组 12 条证据（列表项与详情头部都会出现该计数）
    expect(screen.getAllByText(/12 条页面证据/).length).toBeGreaterThan(0)
    expect(screen.getAllByText('部分通过').length).toBeGreaterThan(0)
    // 详情头部规则
    expect(screen.getAllByText('按钮缺少可访问名称').length).toBeGreaterThan(0)
  })

  it('对未验证页面记录通过后，已有未通过页面不被连带关闭；撤销可回退', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: '载入演示数据' }))

    const state1 = store.getState()
    const groupId = allGroupViews(state1).sort(
      (a, b) => b.counts.total - a.counts.total,
    )[0].group.id
    const before = viewGroup(state1, state1.groups[groupId]).counts.verified

    // “订单列表”在种子数据中是未验证页面
    const row = screen.getByText('订单列表').closest('tr')!
    await user.click(within(row).getByRole('button', { name: '通过' }))

    // 通过数 +1
    const after = viewGroup(store.getState(), store.getState().groups[groupId])
    expect(after.counts.verified).toBe(before + 1)
    // 购物车那条未通过仍然未通过（徽章 + 操作按钮都会出现“未通过”），组仍是部分通过
    expect(screen.getAllByText('未通过').length).toBeGreaterThan(1)
    expect(screen.getAllByText('部分通过').length).toBeGreaterThan(0)

    // 撤销
    await user.click(screen.getByRole('button', { name: /撤销/ }))
    expect(viewGroup(store.getState(), store.getState().groups[groupId]).counts.verified).toBe(before)
  })

  it('证据刷新后旧快照标记过期，并在影响记录中解释影响范围', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: '载入演示数据' }))

    // “搜索结果”在种子中是已通过页面
    const row = screen.getByText('搜索结果').closest('tr')!
    await user.click(within(row).getByRole('button', { name: '重新扫描 / 刷新证据' }))
    const dialogRow = row
    // 改观察现象再提交（证据指纹变化）
    const observedInput = within(dialogRow).getByDisplayValue(
      'button 元素没有文本内容，也没有 aria-label / aria-labelledby',
    )
    await user.clear(observedInput)
    await user.type(observedInput, '重新扫描：名称依然缺失')
    await user.click(within(dialogRow).getByRole('button', { name: '提交刷新' }))

    // 该页行出现过期徽章
    expect(within(row).getByText('快照过期')).toBeInTheDocument()
    // 右侧影响记录：刷新类说明由种子中的 1 条增加到 2 条
    const refreshEntries = store.getState().impactLog.filter((e) => e.kind === 'evidence-refresh')
    expect(screen.getAllByText(/页面证据已刷新/, { selector: '.ii-time' })).toHaveLength(refreshEntries.length)
    expect(screen.getAllByText(/同组其他页面的结论不受影响/, { selector: '.ii-detail' }))
      .toHaveLength(refreshEntries.length)
    expect(screen.getAllByText(/同组其他页面的结论不受影响/).length).toBeGreaterThan(0)
  })

  it('一键复位清空工作台（需确认）', async () => {
    const user = userEvent.setup()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<App />)
    await user.click(screen.getByRole('button', { name: '载入演示数据' }))
    expect(screen.getAllByText(/12 条页面证据/).length).toBeGreaterThan(0)

    await user.click(screen.getByRole('button', { name: '一键复位' }))
    expect(screen.getByText('还没有修复组。')).toBeInTheDocument()
    expect(store.getState().verifications).toHaveLength(0)
  })
})
