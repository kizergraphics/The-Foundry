import { defineConfig } from 'vitest/config'
export default defineConfig({ esbuild: { jsx: 'automatic' }, test: { environment: 'jsdom', include: ['src/lib/pbrMaterial.test.ts', 'src/components/PbrMaterialWorkbench.test.tsx'] } })
