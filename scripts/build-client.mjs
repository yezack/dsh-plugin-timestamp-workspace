/**
 * Build the client half into the dsh client-modules contract:
 *
 *   window.__ModuleLoader__.load({
 *     id: '<package name>',          // MUST equal the package name
 *     factory: (require) => { ... module.exports ... }
 *   })
 *
 * The DSH 0.1.0-rc.6 client-modules loader executes the bundle as a classic
 * script and requires the loader id to be registered via __ModuleLoader__.load;
 * a plain ESM bundle (import/export) fails with:
 *   "loaded without registering <pkg> via __ModuleLoader__.load".
 *
 * The source (src/client.ts) contains no JSX — everything is
 * React.createElement — so a TypeScript transpile to CommonJS is sufficient;
 * type-only imports are erased and `import * as React` becomes require("react"),
 * which the loader's module table resolves.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const PACKAGE_NAME = 'dsh-plugin-timestamp-workspace'

const srcPath = join(root, 'src', 'client.ts')
const outPath = join(root, 'lib', 'client.js')
const source = readFileSync(srcPath, 'utf8')

const result = ts.transpileModule(source, {
  fileName: srcPath,
  compilerOptions: {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.CommonJS,
    moduleResolution: ts.ModuleResolutionKind.Node10,
    esModuleInterop: true,
    jsx: ts.JsxEmit.ReactJSX,
    strict: true,
    importHelpers: false,
  },
})

if (result.diagnostics?.length) {
  for (const d of result.diagnostics) {
    if (d.category === ts.DiagnosticCategory.Error) {
      const msg = ts.flattenDiagnosticMessageText(d.messageText, '\n')
      const pos = d.file && d.start != null ? d.file.getLineAndCharacterOfPosition(d.start) : null
      console.error(`[build-client] TS error: ${msg}${pos ? ` (${pos.line + 1}:${pos.character + 1})` : ''}`)
    }
  }
  process.exit(1)
}

const indent = (text) =>
  text
    .split('\n')
    .map((line) => (line.trim() ? `    ${line}` : line))
    .join('\n')
    .replace(/\s+$/, '')
    .concat('\n')

const banner = `/* dsh-plugin-timestamp-workspace client half
 * Built by scripts/build-client.mjs from src/client.ts into the
 * client-modules contract (classic script; loader id = package name).
 * Do not edit by hand. */
window.__ModuleLoader__.load({
  id: ${JSON.stringify(PACKAGE_NAME)},
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
${indent(result.outputText)}
    return module.exports
  }
})
`

mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, banner)
console.log(`[build-client] wrote ${outPath} (${Buffer.byteLength(banner)} bytes)`)
