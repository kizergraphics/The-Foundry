import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { environment: 'jsdom', include: ['src/lib/actionAnimator.test.ts', 'src/lib/browser.test.ts', 'server/actionAnimator.test.js'] } })
