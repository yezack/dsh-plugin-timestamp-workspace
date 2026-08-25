/**
 * Simulate the dsh client-modules loader to verify lib/client.js:
 * 1. bundle executed as a classic script registers the loader entry,
 * 2. loader id === package name,
 * 3. factory() yields module.exports with name / inject / apply,
 * 4. apply(ctx) wires the slots without throwing — including the real slot
 *    engine's rule that a child slot may only be declared once (the host
 *    declares the directory-flow holes first; a plugin that redeclares them
 *    in a root replacement must fail to apply),
 * 5. the hero directory-flow occupant renders the workspace state row (closed)
 *    and the creation dialog (open); the sidebar occupant renders only the
 *    dialog; the settings.section registration is present with a component.
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
  useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
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

// --- Slot registry stub enforcing the real engine's declaration rules ---
const declaredChildren = new Map() // childKey -> parent entry name
const registrations = []
const injectedSlots = []
const registeredSections = []
const registry = {
  inject(name, factory) {
    injectedSlots.push(name)
    const result = factory()
    // The directoryFlow double-inject passes a generator; run every yield so
    // its register() calls land in the ledger.
    if (result && typeof result.next === 'function') {
      for (let step = result.next(); !step.done; step = result.next()) { /* disposers ignored */ }
    }
    return () => {}
  },
  register(desc, component) {
    // Real engine: a child slot may only be declared once, ever.
    if (desc.children) {
      for (const childKey of Object.keys(desc.children)) {
        if (declaredChildren.has(childKey)) {
          throw new Error(`slot "${childKey}" is already declared (by ${declaredChildren.get(childKey)})`)
        }
      }
      for (const childKey of Object.keys(desc.children)) declaredChildren.set(childKey, desc.name)
    }
    registrations.push({ desc, component })
    if (desc && desc.name === 'settings.section') {
      registeredSections.push({ id: desc.id, label: desc.label(), hasComponent: typeof component === 'function' })
    }
    return () => {}
  },
}

// --- Workspace service stub (mirrors the runtime store contract) ---
let workspaceStore = {
  items: [{ workspaceId: 'ws-1', title: '项目一', sessionIds: ['session-1'] }],
  baselinesReady: true,
  recentWorkspaceId: undefined,
}
let sessionStore = { current: undefined, byId: {} }
const calls = { originalStartSession: [], clear: 0 }
const originalStartSession = (workspaceId) => { calls.originalStartSession.push(workspaceId) }
const workspacesStub = {
  startSession: originalStartSession,
  sessions: {
    clear: () => {
      calls.clear += 1
      sessionStore = { current: undefined, byId: {} }
    },
    list: {
      getSnapshot: () => sessionStore,
      subscribe: () => () => {},
    },
  },
  list: {
    set(next) { workspaceStore = next },
    getSnapshot: () => workspaceStore,
    subscribe: () => () => {},
  },
  pickDirectory: async () => '/tmp/root',
  createDirectory: async (root, name) => `${root}/${name}`,
  create: async ({ path }) => ({ workspaceId: `created:${path}` }),
}
const sessionCalls = []
const sessionsStub = {
  create: async (opts) => {
    sessionCalls.push(opts)
    return { ok: true, value: { sessionId: `temp:${opts.cwd}` } }
  },
  open: async (sessionId) => { sessionCalls.push({ open: sessionId }) },
}

const ctxStub = { slots: registry, workspaces: workspacesStub, sessions: sessionsStub }

// The host bundle (dsh-client-ui-workspace) declares the picker root and its
// directory-flow child FIRST, exactly like the real app. A plugin that
// redeclares the child (full root replacement) must fail apply() here.
registry.register({
  name: 'conversation.hero.workspace',
  children: { 'conversation.hero.workspace.directoryFlow': { kind: 'single', scope: 'root' } },
  inject: () => ({}),
  locale: 'workspace',
}, () => null)
registry.register({
  name: 'sidebar.workspaces',
  children: { 'sidebar.workspaces.directoryFlow': { kind: 'single', scope: 'root' } },
  inject: () => ({}),
  locale: 'workspace',
}, () => null)
const hostRegistrationCount = registrations.length

try {
  mod.apply(ctxStub, { rootDirectory: '/tmp/root' })
} catch (error) {
  console.error(`FAIL: apply() threw (a root replacement redeclaring a host child slot would land here): ${error.message}`)
  process.exit(1)
}
const pluginRegistrations = registrations.slice(hostRegistrationCount)

if (!injectedSlots.includes('conversation.hero.workspace.directoryFlow') || !injectedSlots.includes('sidebar.workspaces.directoryFlow')) {
  console.error(`FAIL: directoryFlow slots not injected (got ${JSON.stringify(injectedSlots)})`)
  process.exit(1)
}
if (!injectedSlots.includes('settings.section')) {
  console.error(`FAIL: settings.section not injected (got ${JSON.stringify(injectedSlots)})`)
  process.exit(1)
}
if (injectedSlots.includes('conversation.hero.workspace')) {
  console.error('FAIL: plugin must not inject a root replacement of conversation.hero.workspace')
  process.exit(1)
}
if (pluginRegistrations.some((entry) => entry.desc?.name === 'conversation.hero.workspace')) {
  console.error('FAIL: plugin must not register a conversation.hero.workspace root entry')
  process.exit(1)
}

const heroReg = pluginRegistrations.find((entry) => entry.desc?.name === 'conversation.hero.workspace.directoryFlow')
const sideReg = pluginRegistrations.find((entry) => entry.desc?.name === 'sidebar.workspaces.directoryFlow')
if (!heroReg || typeof heroReg.component !== 'function') {
  console.error('FAIL: hero directoryFlow occupant not registered with a component')
  process.exit(1)
}
if (!sideReg || typeof sideReg.component !== 'function') {
  console.error('FAIL: sidebar directoryFlow occupant not registered with a component')
  process.exit(1)
}
if ((heroReg.desc.priority ?? 0) !== -1 || (sideReg.desc.priority ?? 0) !== -1) {
  console.error(`FAIL: occupants must shadow the host at priority -1 (hero=${heroReg.desc.priority}, side=${sideReg.desc.priority})`)
  process.exit(1)
}

const renderComponent = (element) => {
  if (element === null || element === false || element === undefined) return []
  if (Array.isArray(element)) return element.flatMap(renderComponent)
  if (typeof element !== 'object') return [element]
  if (typeof element.type === 'function') return renderComponent(element.type(element.props))
  const children = element.props?.children
  return [element, ...renderComponent(children)]
}
const owner = (open) => ({ open, busy: false, onPicked: () => {}, onCancel: () => {}, onError: () => {} })

// Hero occupant, closed, no session -> default workspace state row.
const defaultTree = renderComponent(heroReg.component(owner(false)))
const defaultState = defaultTree.find((node) => node?.props?.['data-timestamp-workspace-state'])
if (defaultState?.props?.['data-timestamp-workspace-state'] !== 'default' || !defaultTree.some((node) => node === '默认工作区')) {
  console.error('FAIL: closed hero occupant did not render the default workspace state')
  process.exit(1)
}
if (defaultTree.some((node) => node === '选择已有工作区')) {
  console.error('FAIL: closed hero occupant must not render the creation dialog')
  process.exit(1)
}

// Hero occupant, closed, session bound to a workspace -> title + clear button.
sessionStore = { current: 'session-1', byId: { 'session-1': { cwd: '/tmp/ws-1' } } }
const selectedTree = renderComponent(heroReg.component(owner(false)))
const selectedState = selectedTree.find((node) => node?.props?.['data-timestamp-workspace-state'])
const clearButton = selectedTree.find((node) => node?.props?.['aria-label'] === '取消当前工作区')
if (selectedState?.props?.['data-timestamp-workspace-state'] !== 'selected' || !selectedTree.some((node) => node === '工作区：项目一') || !clearButton) {
  console.error('FAIL: selected workspace state did not render the title and clear button')
  process.exit(1)
}
clearButton.props.onClick()
if (calls.clear !== 1 || sessionStore.current !== undefined) {
  console.error(`FAIL: clear button did not clear the selection (clear=${calls.clear}, current=${sessionStore.current})`)
  process.exit(1)
}

// Hero occupant, closed, temp task session (no workspace, cwd only) ->
// labeled by its cwd folder name.
sessionStore = { current: 'temp-9', byId: { 'temp-9': { cwd: '/tmp/root/20260825120000' } } }
const tempTree = renderComponent(heroReg.component(owner(false)))
const tempState = tempTree.find((node) => node?.props?.['data-timestamp-workspace-state'])
if (tempState?.props?.['data-timestamp-workspace-state'] !== 'selected' || !tempTree.some((node) => node === '工作区：20260825120000')) {
  console.error('FAIL: temp task session was not labeled by its cwd folder name')
  process.exit(1)
}
sessionStore = { current: undefined, byId: {} }

// Hero occupant, open -> creation dialog.
const openTree = renderComponent(heroReg.component(owner(true)))
if (!openTree.some((node) => node === '选择已有工作区') || !openTree.some((node) => node === '自动创建时间戳工作区') || !openTree.some((node) => node === '取消')) {
  console.error('FAIL: open hero occupant did not render the creation dialog actions')
  process.exit(1)
}

// Sidebar occupant: closed renders nothing, open renders the dialog only.
if (renderComponent(sideReg.component(owner(false))).length !== 0) {
  console.error('FAIL: closed sidebar occupant must render nothing')
  process.exit(1)
}
const sideOpen = renderComponent(sideReg.component(owner(true)))
if (!sideOpen.some((node) => node === '自动创建时间戳工作区') || sideOpen.some((node) => node?.props?.['data-timestamp-workspace-state'])) {
  console.error('FAIL: open sidebar occupant must render the dialog without the state row')
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

// startSession shadowing: a parameterless New Session starts a temporary
// task — a timestamp folder under the root plus an ungrouped session bound
// to that cwd (NOT registered as a workspace) — and opens it, so the
// composer is immediately usable; an explicit workspace target runs the
// host logic.
if (typeof workspacesStub.startSession !== 'function' || workspacesStub.startSession === originalStartSession) {
  console.error('FAIL: workspaces.startSession was not shadowed')
  process.exit(1)
}
const createCalls = []
const createDirectoryStub = async (root, name) => { createCalls.push({ root, name }); return `${root}/${name}` }
const clearBeforeAuto = calls.clear
workspacesStub.createDirectory = createDirectoryStub
const sessionCallsBefore = sessionCalls.length
await workspacesStub.startSession()
if (createCalls.length !== 1 || createCalls[0].root !== '/tmp/root' || !/^\d{14}$/.test(createCalls[0].name)) {
  console.error(`FAIL: temp task did not create a timestamp folder under the root (got ${JSON.stringify(createCalls[0])})`)
  process.exit(1)
}
const createdSession = sessionCalls[sessionCallsBefore]
const opened = sessionCalls[sessionCallsBefore + 1]
if (!createdSession || createdSession.workspaceId !== undefined || typeof createdSession.cwd !== 'string' || !createdSession.cwd.startsWith('/tmp/root/')) {
  console.error(`FAIL: temp task did not create a cwd-only session (got ${JSON.stringify(createdSession)})`)
  process.exit(1)
}
if (!opened || opened.open !== `temp:${createdSession.cwd}`) {
  console.error(`FAIL: temp task session was not opened (got ${JSON.stringify(opened)})`)
  process.exit(1)
}
if (calls.originalStartSession.length !== 0) {
  console.error(`FAIL: temp task must not forward to the host startSession (got ${JSON.stringify(calls.originalStartSession)})`)
  process.exit(1)
}
if (calls.clear !== clearBeforeAuto) {
  console.error('FAIL: successful temp task must not clear the selection')
  process.exit(1)
}
// explicit target forwards to the host logic
workspacesStub.startSession('ws-1')
if (calls.originalStartSession.length !== 1 || calls.originalStartSession[0] !== 'ws-1') {
  console.error(`FAIL: explicit startSession did not forward (got ${JSON.stringify(calls.originalStartSession)})`)
  process.exit(1)
}
// failure path: a failing folder create falls back to the blank view
workspacesStub.createDirectory = async () => { throw new Error('boom') }
await workspacesStub.startSession()
if (calls.clear !== clearBeforeAuto + 1) {
  console.error(`FAIL: failed temp task did not fall back to clearing (clear=${calls.clear})`)
  process.exit(1)
}
// Idempotent: a second apply() must not wrap the method again — the same
// shadow keeps starting temp tasks.
workspacesStub.createDirectory = createDirectoryStub
const sessionCallsBefore2 = sessionCalls.length
mod.apply(ctxStub, { rootDirectory: '/tmp/root' })
await workspacesStub.startSession()
if (sessionCalls.length !== sessionCallsBefore2 + 2) {
  console.error('FAIL: re-apply double-wrapped startSession')
  process.exit(1)
}

// Startup auto-selection suppression: the host startInitialSelection
// reconcile only connects when the first ready projection carries a
// recentWorkspaceId and no current session is restored. The mask must
// blank recentWorkspaceId on that first ready projection, then restore
// the original setter (one-shot) so later projections pass through.
// The masks are module-level one-shots already consumed by the main apply,
// so this phase runs against a fresh module instance.
let startupRegistered = null
new Function('window', 'require', code)({ __ModuleLoader__: { load(entry) { startupRegistered = entry } } }, requireStub)
const startupMod = startupRegistered.factory(requireStub)
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
startupMod.apply(startupCtx, { rootDirectory: '/tmp/root' })
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
startupMod.apply(startupCtx, { rootDirectory: '/tmp/root' })
if (startupCtx.workspaces.list.set !== setBefore) {
  console.error('FAIL: re-apply re-wrapped list.set')
  process.exit(1)
}

console.log('PASS: loader id OK, exports OK, apply() survives the host child-slot declaration (no root replacement), hero occupant renders state row + clear + dialog, sidebar occupant dialog-only, settings.section registered with component, startSession shadowed (no-arg starts a temp task: timestamp folder + cwd-only ungrouped session, explicit forwards, failure falls back, re-apply idempotent), startup auto-selection suppressed (first ready projection masks recentWorkspaceId, then one-shot restores)')
