/**
 * Simulate the dsh client-modules loader to verify lib/client.js:
 * 1. bundle executed as a classic script registers the loader entry,
 * 2. loader id === package name,
 * 3. factory() yields module.exports with name / inject / apply,
 * 4. apply(ctx) wires the slots without throwing (stubbed ctx).
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const PACKAGE_NAME = 'dsh-plugin-timestamp-workspace'
const code = readFileSync(join(root, 'lib', 'client.js'), 'utf8')

let registered = null
const windowObj = {
  __ModuleLoader__: {
    load(entry) { registered = entry },
  },
}

const reactStub = { createElement: () => ({}), useState: () => [], createContext: () => ({}) }
const requireStub = (spec) => {
  if (spec === 'react') return reactStub
  throw new Error(`unexpected require('${spec}')`)
}

// Execute as a classic script (factory body runs inside a function scope).
new Function('window', 'require', code)(windowObj, requireStub)

if (!registered) {
  console.error('FAIL: bundle did not register via window.__ModuleLoader__.load')
  process.exit(1)
}
if (registered.id !== PACKAGE_NAME) {
  console.error(`FAIL: loader id "${registered.id}" !== package name "${PACKAGE_NAME}"`)
  process.exit(1)
}
if (typeof registered.factory !== 'function') {
  console.error('FAIL: loader entry has no factory function')
  process.exit(1)
}

const mod = registered.factory(requireStub)
const problems = []
if (mod.name !== 'timestamp-workspace-client') problems.push(`name=${mod.name}`)
if (!Array.isArray(mod.inject) || !mod.inject.includes('slots') || !mod.inject.includes('workspaces')) problems.push(`inject=${JSON.stringify(mod.inject)}`)
if (typeof mod.apply !== 'function') problems.push('apply not a function')
if (typeof mod.formatTimestamp !== 'function') problems.push('formatTimestamp not exported')
if (typeof mod.createTimestampWorkspace !== 'function') problems.push('createTimestampWorkspace not exported')
if (problems.length) {
  console.error(`FAIL: ${problems.join('; ')}`)
  process.exit(1)
}

// apply() with a stubbed ctx: slots.inject should be invoked.
let injected = 0
const ctxStub = {
  slots: {
    inject(name, fn) { injected++; if (typeof fn === 'function') fn() },
    register() { return () => {} },
  },
  workspaces: {
    pickDirectory: async () => '/tmp/root',
    createDirectory: async (root, name) => `${root}/${name}`,
  },
}
mod.apply(ctxStub, { rootDirectory: '/tmp/root' })
if (injected < 1) {
  console.error('FAIL: apply() did not inject any slot')
  process.exit(1)
}

console.log('PASS: loader id OK, exports { name, inject, apply, formatTimestamp, createTimestampWorkspace } OK, apply() wired slots OK')
