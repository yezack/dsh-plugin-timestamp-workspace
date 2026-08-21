/**
 * Simulate the dsh client-modules loader to verify lib/client.js:
 * 1. bundle executed as a classic script registers the loader entry,
 * 2. loader id === package name,
 * 3. factory() yields module.exports with name / inject / apply,
 * 4. apply(ctx) wires the slots without throwing (stubbed ctx),
 * 5. the settings.section registration is present with a component.
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

const reactStub = {
  createElement: () => ({}),
  useState: () => [],
  useEffect: () => {},
  createContext: () => ({}),
}
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

// apply() with a stubbed ctx: both slot families should be injected.
const injectedSlots = []
const registeredSections = []
const calls = { originalStartSession: [], clear: 0 }
const originalStartSession = (workspaceId) => { calls.originalStartSession.push(workspaceId) }
const ctxStub = {
  slots: {
    inject(name, fn) {
      injectedSlots.push(name)
      if (typeof fn === 'function') fn()
    },
    register(desc, component) {
      if (desc && desc.name === 'settings.section') registeredSections.push({ id: desc.id, label: desc.label(), hasComponent: typeof component === 'function' })
      return () => {}
    },
  },
  workspaces: {
    startSession: originalStartSession,
    sessions: { clear: () => { calls.clear += 1 } },
    pickDirectory: async () => '/tmp/root',
    createDirectory: async (root, name) => `${root}/${name}`,
  },
}
mod.apply(ctxStub, { rootDirectory: '/tmp/root' })

if (!injectedSlots.includes('conversation.hero.workspace.directoryFlow')) {
  console.error(`FAIL: directoryFlow slot not injected (got ${JSON.stringify(injectedSlots)})`)
  process.exit(1)
}
const section = registeredSections.find((s) => s.id === 'timestamp-workspace')
if (!section) {
  console.error(`FAIL: settings.section "timestamp-workspace" not registered (got ${JSON.stringify(registeredSections)})`)
  process.exit(1)
}
if (!section.hasComponent) {
  console.error('FAIL: settings.section registered without a render component')
  process.exit(1)
}

// startSession shadowing: a parameterless New Session must clear into the
// workspace-less view (host default would inherit the recent folder), while
// an explicit workspace target must still run the host logic.
if (typeof ctxStub.workspaces.startSession !== 'function' || ctxStub.workspaces.startSession === originalStartSession) {
  console.error('FAIL: workspaces.startSession was not shadowed')
  process.exit(1)
}
ctxStub.workspaces.startSession()
ctxStub.workspaces.startSession('ws-1')
if (calls.clear !== 1) {
  console.error(`FAIL: parameterless startSession did not clear exactly once (clear=${calls.clear})`)
  process.exit(1)
}
if (calls.originalStartSession.length !== 1 || calls.originalStartSession[0] !== 'ws-1') {
  console.error(`FAIL: explicit startSession did not forward to the host logic (got ${JSON.stringify(calls.originalStartSession)})`)
  process.exit(1)
}
// Idempotent: a second apply() must not wrap the method again.
mod.apply(ctxStub, { rootDirectory: '/tmp/root' })
ctxStub.workspaces.startSession()
if (calls.clear !== 2) {
  console.error(`FAIL: re-apply double-wrapped startSession (clear=${calls.clear})`)
  process.exit(1)
}

console.log('PASS: loader id OK, exports OK, directoryFlow wired, settings.section "timestamp-workspace" registered with component, startSession shadowed (no-arg clears, explicit forwards, re-apply idempotent)')
