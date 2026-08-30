/**
 * Simulate the dsh client-modules loader to verify lib/client.js:
 * 1. bundle executed as a classic script registers the loader entry,
 * 2. loader id === package name,
 * 3. factory() yields module.exports with name / inject / apply,
 * 4. apply(ctx) wires the slots without throwing,
 * 5. New Session is NOT hijacked: workspaces.startSession keeps the host fn,
 *    and no directory-flow occupant is registered (the host native add-flow
 *    is restored),
 * 6. the hero workspace-picker entry is wrapped in place: the wrapper renders
 *    the "开启临时会话" button next to the host picker, and clicking it creates
 *    a timestamp folder under the root + a cwd-only session and opens it
 *    (failures keep the current view, no clear),
 * 7. the sidebar workspace-browser entry is wrapped (ungrouped pin/badge) and
 *    the composer.bar entry is wrapped (temporary sessions unlocked),
 * 8. the settings.section registration is present with a component.
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
  useLayoutEffect: () => {},
  useRef: () => ({ current: null }),
  useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
  createContext: () => ({}),
}
const primitivesStub = {
  Modal: (props) => ({ modal: true, ...props }),
  Button: (props) => ({ button: true, ...props }),
}
const requireStub = (spec) => {
  if (spec === 'react') return reactStub
  if (spec === '@deepseek-ai/dsh-client-ui-primitives') return primitivesStub
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

// --- Slot registry stub: entries() lets plugins wrap host entries in place ---
const registrations = []
const injectedSlots = []
const registeredSections = []
const registry = {
  entries(name) {
    return registrations.filter((entry) => entry.desc.name === name)
  },
  inject(name, factory) {
    injectedSlots.push(name)
    const result = factory()
    if (result && typeof result.next === 'function') {
      for (let step = result.next(); !step.done; step = result.next()) { /* disposers ignored */ }
    }
    return () => {}
  },
  register(desc, component) {
    registrations.push({ desc, component })
    if (desc && desc.name === 'settings.section') {
      registeredSections.push({ id: desc.id, label: desc.label(), hasComponent: typeof component === 'function' })
    }
    return () => {}
  },
}

// --- Workspace / session service stubs (mirror the runtime store contract) ---
let workspaceStore = {
  items: [{ workspaceId: 'ws-1', title: '项目一', sessionIds: ['session-1'] }],
  baselinesReady: true,
  recentWorkspaceId: undefined,
  archivedSessionIds: [],
}
let sessionStore = { current: undefined, byId: {}, ids: [] }
const calls = { originalStartSession: [], clear: 0 }
const originalStartSession = (workspaceId) => { calls.originalStartSession.push(workspaceId) }
const workspacesStub = {
  startSession: originalStartSession,
  sessions: {
    clear: () => {
      calls.clear += 1
      sessionStore = { current: undefined, byId: {}, ids: [] }
    },
    list: {
      getSnapshot: () => sessionStore,
      subscribe: () => () => {},
    },
  },
  list: {
    getSnapshot: () => workspaceStore,
    subscribe: () => () => {},
  },
  pickDirectory: async () => '/tmp/root',
  createDirectory: async (root, name) => `${root}/${name}`,
  archiveSession: async () => {},
}
const sessionCalls = []
const sessionsStub = {
  create: async (opts) => {
    sessionCalls.push(opts)
    return `temp:${opts.cwd}` // SessionRuntime: resolves to the id string
  },
  open: async (sessionId) => { sessionCalls.push({ open: sessionId }) },
  list: {
    getSnapshot: () => sessionStore,
    subscribe: () => () => {},
  },
}

const ctxStub = { slots: registry, workspaces: workspacesStub, sessions: sessionsStub }

// Host entries registered BEFORE the plugin applies, exactly like the app:
// the picker root (with its host-declared directory-flow child), the sidebar
// browser, and the composer bar.
const hostHeroComponent = () => null
const hostSidebarComponent = () => null
const hostComposerComponent = (props) => props
registry.register({
  name: 'conversation.hero.workspace',
  children: { 'conversation.hero.workspace.directoryFlow': { kind: 'single', scope: 'root' } },
  inject: () => ({}),
  locale: 'workspace',
}, hostHeroComponent)
registry.register({
  name: 'sidebar.workspaces',
  children: { 'sidebar.workspaces.directoryFlow': { kind: 'single', scope: 'root' } },
  inject: () => ({}),
  locale: 'workspace',
}, hostSidebarComponent)
registry.register({
  name: 'conversation.composer.bar',
  inject: () => ({}),
}, hostComposerComponent)
const hostRegistrationCount = registrations.length

try {
  mod.apply(ctxStub, { rootDirectory: '/tmp/root' })
} catch (error) {
  console.error(`FAIL: apply() threw: ${error.message}`)
  process.exit(1)
}

const heroEntry = registry.entries('conversation.hero.workspace')[0]
const sidebarEntry = registry.entries('sidebar.workspaces')[0]
const composerEntry = registry.entries('conversation.composer.bar')[0]
if (!heroEntry || heroEntry.component === hostHeroComponent) {
  console.error('FAIL: hero workspace-picker entry was not wrapped in place')
  process.exit(1)
}
if (!sidebarEntry || sidebarEntry.component === hostSidebarComponent) {
  console.error('FAIL: sidebar workspace-browser entry was not wrapped in place')
  process.exit(1)
}
if (!composerEntry || composerEntry.component === hostComposerComponent) {
  console.error('FAIL: composer.bar entry was not wrapped in place')
  process.exit(1)
}

// New Session is NOT hijacked: the host method object is untouched, and no
// directory-flow occupant (or root replacement) is registered by the plugin.
if (workspacesStub.startSession !== originalStartSession) {
  console.error('FAIL: workspaces.startSession was shadowed (New Session must keep host logic)')
  process.exit(1)
}
if (injectedSlots.includes('conversation.hero.workspace.directoryFlow') || injectedSlots.includes('sidebar.workspaces.directoryFlow')) {
  console.error(`FAIL: plugin must not occupy the directory-flow holes (got ${JSON.stringify(injectedSlots)})`)
  process.exit(1)
}
if (injectedSlots.includes('conversation.hero.workspace')) {
  console.error('FAIL: plugin must not inject a root replacement of conversation.hero.workspace')
  process.exit(1)
}
const pluginRegistrations = registrations.slice(hostRegistrationCount)
if (pluginRegistrations.some((entry) => entry.desc?.name === 'conversation.hero.workspace' || entry.desc?.name === 'sidebar.workspaces')) {
  console.error('FAIL: plugin must not register competing root entries')
  process.exit(1)
}

// --- Render helper (walks the createElement tree) ---
const renderComponent = (element) => {
  if (element === null || element === false || element === undefined) return []
  if (Array.isArray(element)) return element.flatMap(renderComponent)
  if (typeof element !== 'object') return [element]
  if (typeof element.type === 'function') return renderComponent(element.type(element.props))
  const children = element.props?.children
  return [element, ...renderComponent(children)]
}

// --- Hero picker wrapper: the "开启临时会话" button next to the host picker ---
const heroTree = renderComponent(heroEntry.component({ open: false, onPick: () => {}, onClose: () => {} }))
const tempButton = heroTree.find((node) => node?.type === 'button' && node?.props?.className === 'dsh-timestamp-hero-temp-button')
if (!tempButton) {
  console.error('FAIL: hero wrapper did not render the "开启临时会话" button')
  process.exit(1)
}
if (tempButton.props.disabled === true || tempButton.props.children !== '开启临时会话') {
  console.error(`FAIL: hero button wrong state (disabled=${tempButton.props.disabled}, text=${tempButton.props.children})`)
  process.exit(1)
}

// Click the button: timestamp folder under the root + cwd-only session + open.
const createCalls = []
const createDirectoryStub = async (root, name) => { createCalls.push({ root, name }); return `${root}/${name}` }
workspacesStub.createDirectory = createDirectoryStub
const sessionCallsBefore = sessionCalls.length
const clearBefore = calls.clear
tempButton.props.onClick()
await new Promise((resolve) => setTimeout(resolve, 25))
if (createCalls.length !== 1 || createCalls[0].root !== '/tmp/root' || !/^\d{14}$/.test(createCalls[0].name)) {
  console.error(`FAIL: temp task did not create a timestamp folder under the root (got ${JSON.stringify(createCalls)})`)
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
if (calls.clear !== clearBefore) {
  console.error('FAIL: successful temp task must not clear the selection')
  process.exit(1)
}

// Failure path: a failing folder create keeps the view and surfaces an error
// next to the button (no session created, no clear).
const sessionCallsAtFail = sessionCalls.length
workspacesStub.createDirectory = async () => { throw new Error('boom') }
tempButton.props.onClick()
await new Promise((resolve) => setTimeout(resolve, 25))
if (calls.clear !== clearBefore || sessionCalls.length !== sessionCallsAtFail) {
  console.error(`FAIL: failed temp task must keep the view without creating (clear=${calls.clear})`)
  process.exit(1)
}
const errorTree = renderComponent(heroEntry.component({ open: false }))
const alertSpan = errorTree.find((node) => node?.type === 'span' && node?.props?.role === 'alert')
if (!alertSpan || !String(alertSpan.props.children).includes('boom')) {
  console.error(`FAIL: temp task failure was not surfaced next to the hero button (got ${JSON.stringify(alertSpan?.props?.children)})`)
  process.exit(1)
}
workspacesStub.createDirectory = createDirectoryStub

// Re-apply is idempotent: the hero entry is not double-wrapped.
const heroComponentBefore = heroEntry.component
mod.apply(ctxStub, { rootDirectory: '/tmp/root' })
if (heroEntry.component !== heroComponentBefore) {
  console.error('FAIL: re-apply double-wrapped the hero picker entry')
  process.exit(1)
}
if (workspacesStub.startSession !== originalStartSession) {
  console.error('FAIL: re-apply shadowed workspaces.startSession')
  process.exit(1)
}

// --- Composer bar wrapper: temporary (cwd-only, ungrouped) sessions unlock ---
sessionStore = { current: 'temp-9', byId: { 'temp-9': { cwd: '/tmp/root/20260825120000' } }, ids: ['temp-9'] }
// The host composer stub is (props) => props; the wrapper renders it via
// createElement, so walk the tree to reach the composed props object. The
// real host passes useSessions/useWorkspaces selector hooks in the props.
const composerProps = (sessionId) => ({
  sessionId,
  disabled: true,
  placeholder: sessionId === 'temp-9' ? '选择一个工作区开始' : '选择工作区',
  useSessions: (selector) => selector(sessionStore),
  useWorkspaces: (selector) => selector(workspaceStore),
})
const composed = renderComponent(composerEntry.component(composerProps('temp-9')))[0]
if (composed.disabled !== false) {
  console.error('FAIL: temporary session composer stayed disabled')
  process.exit(1)
}
if (composed.placeholder !== '选择一个工作区或以临时会话开始') {
  console.error(`FAIL: temporary session placeholder not replaced (got ${composed.placeholder})`)
  process.exit(1)
}
// A session registered under a real workspace keeps the host props untouched.
const registeredComposed = renderComponent(composerEntry.component(composerProps('session-1')))[0]
if (registeredComposed.disabled !== true || registeredComposed.placeholder !== '选择工作区') {
  console.error('FAIL: non-temporary composer props were modified')
  process.exit(1)
}
sessionStore = { current: undefined, byId: {}, ids: [] }

// --- Sidebar wrapper renders without throwing (ungrouped pin/badge) ---
if (renderComponent(sidebarEntry.component({ useSessions: () => undefined, useWorkspaces: () => undefined })).length === 0) {
  console.error('FAIL: sidebar wrapper rendered nothing')
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

// --- Batch archive dialog: host Modal + disabled 归档 button until selection ---
workspaceStore = {
  items: [{ workspaceId: 'ws-1', title: '项目一', sessionIds: ['session-1', 'session-2'] }],
  baselinesReady: true,
  archivedSessionIds: [],
}
sessionStore = {
  current: undefined,
  byId: {
    'session-1': { title: '会话 A', blank: false },
    'session-2': { title: '会话 B', blank: false },
  },
  ids: ['session-1', 'session-2'],
}
if (typeof mod.BatchArchiveDialog !== 'function') {
  console.error('FAIL: BatchArchiveDialog not exported')
  process.exit(1)
}
const dialogTree = renderComponent(mod.BatchArchiveDialog({ workspaceId: 'ws-1', label: '项目一', onClose: () => {} }))
const modalNode = dialogTree.find((node) => node && node.modal === true)
if (!modalNode) {
  console.error('FAIL: batch archive dialog did not render the host Modal')
  process.exit(1)
}
if (modalNode.title !== '批量归档 · 项目一') {
  console.error(`FAIL: batch dialog wrong title (got ${modalNode.title})`)
  process.exit(1)
}
// Body lists both sessions (children sit on the stub Modal object).
const bodyTree = renderComponent(modalNode.children)
if (!bodyTree.some((node) => node === '会话 A') || !bodyTree.some((node) => node === '会话 B')) {
  console.error('FAIL: batch dialog did not list the workspace sessions')
  process.exit(1)
}
// Footer holds 取消 + 归档 (disabled with nothing selected).
const footerChildren = modalNode.footer?.props?.children
const archiveButtonEl = Array.isArray(footerChildren) ? footerChildren.find((c) => c?.props?.children === '归档') : undefined
if (!archiveButtonEl || archiveButtonEl.props.disabled !== true) {
  console.error('FAIL: batch dialog 归档 button missing or not disabled with no selection')
  process.exit(1)
}

// Ungrouped mode (workspaceId undefined): lists the ungrouped bucket's
// visible sessions — registered workspace sessions are excluded.
sessionStore = {
  current: undefined,
  byId: {
    'session-1': { title: '会话 A', blank: false },
    'temp-9': { cwd: '/tmp/root/20260825120000', title: '临时任务 9', blank: false },
  },
  ids: ['session-1', 'temp-9'],
}
const ungroupedTree = renderComponent(mod.BatchArchiveDialog({ workspaceId: undefined, label: '未分组', onClose: () => {} }))
const ungroupedModal = ungroupedTree.find((node) => node && node.modal === true)
if (!ungroupedModal || ungroupedModal.title !== '批量归档 · 未分组') {
  console.error('FAIL: ungrouped batch dialog wrong title')
  process.exit(1)
}
const ungroupedBody = renderComponent(ungroupedModal.children)
if (!ungroupedBody.some((node) => node === '临时任务 9') || ungroupedBody.some((node) => node === '会话 A')) {
  console.error('FAIL: ungrouped batch dialog did not filter to the ungrouped sessions')
  process.exit(1)
}
sessionStore = { current: undefined, byId: {}, ids: [] }

// --- Newer host shape: ctx.workspaces is a pure controller (no directory
// capabilities) and there is no ctx.uiWorkspace dependency (the runner would
// reject reading an undeclared service). The plugin must create folders
// through its own host route via fetch, and apply() must not throw. ---
let freshRegistered = null
new Function('window', 'require', code)({ __ModuleLoader__: { load(entry) { freshRegistered = entry } } }, requireStub)
const freshMod = freshRegistered.factory(requireStub)
const freshRegs = []
const freshRegistry = {
  entries: (name) => freshRegs.filter((r) => r.desc.name === name),
  inject: (name, factory) => { const r = factory(); if (r?.next) { for (let s = r.next(); !s.done; s = r.next()) {} } return () => {} },
  register: (desc, component) => { freshRegs.push({ desc, component }); return () => {} },
}
freshRegistry.register({
  name: 'conversation.hero.workspace',
  children: { 'conversation.hero.workspace.directoryFlow': { kind: 'single', scope: 'root' } },
  inject: () => ({}),
}, () => null)
const uiCalls = []
const freshWorkspaces = {
  // Pure controller: list/archiveSession only, NO createDirectory/pickDirectory.
  list: { getSnapshot: () => ({ items: [], archivedSessionIds: [] }), subscribe: () => () => {} },
  archiveSession: async (id) => { uiCalls.push({ controllerArchive: id }) },
}
const freshSessions = {
  create: async (opts) => { uiCalls.push({ create: opts }); return `temp:${opts.cwd}` },
  open: async (id) => { uiCalls.push({ open: id }) },
}
// Mock fetch so the plugin's own create-directory route answers (settings
// route fails -> resolveRoot falls back to the config rootDirectory).
const realFetch = globalThis.fetch
const fetchCalls = []
globalThis.fetch = async (url, opts) => {
  const u = String(url)
  fetchCalls.push(u)
  if (u.includes('/api/timestamp-workspace/create-directory')) {
    const body = JSON.parse(opts?.body ?? '{}')
    return { ok: true, json: async () => ({ ok: true, path: `${body.root}/${body.name}` }) }
  }
  if (u.includes('/api/timestamp-workspace/settings')) {
    return { ok: false, json: async () => ({ error: 'unavailable' }) }
  }
  return realFetch(url, opts)
}
let freshApplyError = null
try {
  freshMod.apply({ slots: freshRegistry, workspaces: freshWorkspaces, sessions: freshSessions }, { rootDirectory: '/tmp/root' })
} catch (error) {
  freshApplyError = error
}
if (freshApplyError !== null) {
  console.error(`FAIL: fresh-host apply() threw (undeclared service read?): ${freshApplyError.message}`)
  process.exit(1)
}
const freshHeroEntry = freshRegistry.entries('conversation.hero.workspace')[0]
const freshTree = renderComponent(freshHeroEntry.component({ open: false }))
const freshButton = freshTree.find((node) => node?.type === 'button' && node?.props?.className === 'dsh-timestamp-hero-temp-button')
if (!freshButton) {
  console.error('FAIL: fresh-host hero button missing')
  process.exit(1)
}
freshButton.props.onClick()
await new Promise((resolve) => setTimeout(resolve, 25))
if (!fetchCalls.some((u) => u.includes('/api/timestamp-workspace/create-directory'))) {
  console.error('FAIL: temp task did not call the plugin create-directory route')
  process.exit(1)
}
if (!uiCalls.some((call) => call.open && call.open.startsWith('temp:/tmp/root/'))) {
  console.error(`FAIL: fresh-host temp task session was not opened (got ${JSON.stringify(uiCalls)})`)
  process.exit(1)
}
if (!uiCalls.some((call) => call.create && call.create.cwd && call.create.cwd.startsWith('/tmp/root/'))) {
  console.error('FAIL: fresh-host temp task did not create a cwd-only session from the route path')
  process.exit(1)
}
globalThis.fetch = realFetch

console.log('PASS: loader id OK, exports OK, apply() survives host child-slot declarations, New Session untouched (startSession intact, no directory-flow occupant), hero picker wrapped in place with the 开启临时会话 button (click creates a timestamp folder + cwd-only session + open; failures keep the view and surface the error), composer bar unlocks temporary sessions only, sidebar browser wrapped, batch archive dialog renders the host Modal (workspace and ungrouped modes) with the session list and a disabled 归档 action, settings.section registered, re-apply idempotent, pure-controller host shape applies without uiWorkspace and creates folders via the plugin route')
