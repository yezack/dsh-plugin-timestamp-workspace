import { defineConfig } from 'tsdown'
export default defineConfig({ entry: ['src/index.ts', 'src/client.ts'], dts: true, format: 'esm', outDir: 'lib', clean: true })
