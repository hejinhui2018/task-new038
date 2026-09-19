import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

// vitest 未开启 globals，需要显式注册 RTL 的逐测试清理
afterEach(() => {
  cleanup()
})
