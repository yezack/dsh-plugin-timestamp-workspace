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
  Fragment: Symbol('Fragment'),
  createElement: (type, props, ...children) => ({
    type,
    props: { ...(props || {}), children: children.length === 1 ? children[0] : children },
  }),
  useState: (initial) => [initial, () => {}],
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
const registrations = []
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
      registrations.push({ desc, component })
      if (desc && desc.name === 'settings.section') registeredSections.push({ id: desc.id, label: desc.label(), hasComponent: typeof component === 'function' })
      return () => {}
    },
    entries: () => [],
    subscribe: () => () => {},
  },
  workspaces: {
    startSession: originalStartSession,
    sessions: { clear: () => { calls.clear += 1 } },
    pickDirectory: async () => '/tmp/root',
    createDirectory: async (root, name) => `${root}/${name}`,
    create: async ({ path }) => ({ workspaceId: `created:${path}` }),
  },
}
mod.apply(ctxStub, { rootDirectory: '/tmp/root' })

if (!injectedSlots.includes('conversation.hero.workspace.directoryFlow')) {
  console.error(`FAIL: directoryFlow slot not injected (got ${JSON.stringify(injectedSlots)})`)
  process.exit(1)
}
const pickerRegistration = registrations.find((entry) => entry.desc?.name === 'conversation.hero.workspace')
if (!pickerRegistration || typeof pickerRegistration.component !== 'function') {
  console.error('FAIL: complete conversation.hero.workspace slot was not registered with a component')
  process.exit(1)
}
if (pickerRegistration.desc.priority !== -1) {
  console.error(`FAIL: complete picker slot priority is ${pickerRegistration.desc.priority}, expected -1`)
  process.exit(1)
}
const pickerState = {
  items: [{ workspaceId: 'ws-1', title: '项目一', sessionIds: [] }],
  phase: 'ready',
}
const pickerProps = {
  open: false,
  selectedId: undefined,
  onPick: () => {},
  onClose: () => {},
  useWorkspaces: (selector) => selector(pickerState),
  useDirectoryFlow: (selector) => selector(true),
  renderSlot: () => null,
  createWorkspace: async ({ path }) => ({ workspaceId: `created:${path}` }),
  t: (key) => key,
}
const renderComponent = (element) => {
  if (element === null || element === false || element === undefined) return []
  if (Array.isArray(element)) return element.flatMap(renderComponent)
  if (typeof element !== 'object') return [element]
  if (typeof element.type === 'function') return renderComponent(element.type(element.props))
  const children = element.props?.children
  return [element, ...renderComponent(children)]
}
const defaultTree = renderComponent(pickerRegistration.component(pickerProps))
const defaultState = defaultTree.find((node) => node?.props?.['data-timestamp-workspace-state'])
if (defaultState?.props?.['data-timestamp-workspace-state'] !== 'default' || !defaultTree.some((node) => node === '默认工作区')) {
  console.error('FAIL: empty selection did not render the default workspace state')
  process.exit(1)
}
let closed = 0
const clearPickerProps = {
  ...pickerProps,
  selectedId: 'ws-1',
  onClose: () => { closed += 1 },
}
const selectedTree = renderComponent(pickerRegistration.component(clearPickerProps))
const selectedState = selectedTree.find((node) => node?.props?.['data-timestamp-workspace-state'])
const clearButton = selectedTree.find((node) => node?.props?.['aria-label'] === '取消当前工作区')
if (selectedState?.props?.['data-timestamp-workspace-state'] !== 'selected' || !selectedTree.some((node) => node === '工作区：项目一') || !clearButton) {
  console.error('FAIL: selected workspace state did not render the title and clear button')
  process.exit(1)
}
clearButton.props.onClick()
if (calls.clear !== 1 || closed !== 1) {
  console.error(`FAIL: clear button did not clear and close (clear=${calls.clear}, closed=${closed})`)
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
if (calls.clear !== 2) {
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
if (calls.clear !== 3) {
  console.error(`FAIL: re-apply double-wrapped startSession (clear=${calls.clear})`)
  process.exit(1)
}

// Startup auto-selection suppression: the host startInitialSelection
// reconcile only connects when the first ready projection carries a
// recentWorkspaceId and no current session is restored. The mask must
// blank recentWorkspaceId on that first ready projection, then restore
// the original setter (one-shot) so later projections pass through.
const setCalls = []
let storeState = { baselinesReady: false, recentWorkspaceId: 'ws-recent' }
const startupCtx = {
  slots: { inject() {}, register() { return () => {} } },
  workspaces: {
    startSession: () => {},
    sessions: { clear: () => {}, list: { getSnapshot: () => ({ current: undefined }) } },
    list: {
      set(next) { setCalls.push(next); storeState = next },
      getSnapshot: () => storeState,
    },
    pickDirectory: async () => '/tmp/root',
    createDirectory: async (root, name) => `${root}/${name}`,
    create: async ({ path }) => ({ workspaceId: `created:${path}` }),
  },
}
mod.apply(startupCtx, { rootDirectory: '/tmp/root' })
// first ready projection (cold boot, no restored session)
startupCtx.workspaces.list.set({ ...storeState, baselinesReady: true, recentWorkspaceId: 'ws-recent' })
if (setCalls.length !== 1 || setCalls[0].recentWorkspaceId !== undefined) {
  console.error(`FAIL: first ready projection did not mask recentWorkspaceId (got ${JSON.stringify(setCalls[0])})`)
  process.exit(1)
}
// later projection (user activity) passes through unchanged
startupCtx.workspaces.list.set({ baselinesReady: true, recentWorkspaceId: 'ws-other' })
if (setCalls.length !== 2 || setCalls[1].recentWorkspaceId !== 'ws-other') {
  console.error(`FAIL: post-startup projection was not passed through (got ${JSON.stringify(setCalls[1])})`)
  process.exit(1)
}
// re-apply is idempotent: setter stays the restored original, no re-wrap
const setBefore = startupCtx.workspaces.list.set
mod.apply(startupCtx, { rootDirectory: '/tmp/root' })
if (startupCtx.workspaces.list.set !== setBefore) {
  console.error('FAIL: re-apply re-wrapped list.set')
  process.exit(1)
}

console.log('PASS: loader id OK, exports OK, directoryFlow wired, settings.section "timestamp-workspace" registered with component, startSession shadowed (no-arg clears, explicit forwards, re-apply idempotent), startup auto-selection suppressed (first ready projection masks recentWorkspaceId, then one-shot restores)')
