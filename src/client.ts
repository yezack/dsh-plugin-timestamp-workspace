import * as React from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'

export const name = 'timestamp-workspace-client'
export const inject = ['slots', 'workspaces', 'sessions']
// The client half does not receive the patch-insert config (host-side only,
// like dsh-ssh); rootDirectory is resolved from the settings route, and the
// apply-time config is only a last-resort fallback.
export interface Config { rootDirectory?: string }

export function formatTimestamp(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return String(date.getFullYear()) + pad(date.getMonth() + 1) + pad(date.getDate()) + pad(date.getHours()) + pad(date.getMinutes()) + pad(date.getSeconds())
}

export async function createTimestampWorkspace(createDirectory: (root: string, name: string) => Promise<string>, rootDirectory: string, date = new Date()): Promise<string> {
  const root = rootDirectory.trim()
  if (!root) throw new Error('rootDirectory 未配置')
  // Same-second conflicts (the current temp task may already own this second):
  // retry the next seconds before giving up.
  let attempt = date
  let lastError: unknown
  for (let i = 0; i < 3; i++) {
    try {
      return await createDirectory(root, formatTimestamp(attempt))
    } catch (reason) {
      lastError = reason
      attempt = new Date(attempt.getTime() + 1000)
    }
  }
  throw lastError instanceof Error ? lastError : new Error('目录创建失败（时间戳多次冲突）')
}

/** The plugin's own fenced settings route (host half serves it). */
const SETTINGS_URL = '/api/timestamp-workspace/settings'

async function fetchSettings(): Promise<{ rootDirectory: string }> {
  const res = await fetch(SETTINGS_URL)
  if (!res.ok) throw new Error(`settings fetch failed: ${res.status}`)
  return res.json()
}

async function updateSettings(rootDirectory: string): Promise<void> {
  const res = await fetch(SETTINGS_URL, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ rootDirectory }),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => null)
    throw new Error((data && typeof data.error === 'string' && data.error) || `settings update failed: ${res.status}`)
  }
}

// The settings section component renders inside the host settings shell,
// outside the directory-flow render tree, so it reaches the host APIs
// through the apply-time context captured here.
let runtime: ClientContext | null = null

// rootDirectory fallback from the patch-insert config (yaml). The live value
// always comes from the settings route; this only backs a route failure.
let fallbackRoot = ''

type TaskStatus = { phase: 'idle' | 'busy' | 'error'; message?: string }
let taskStatus: TaskStatus = { phase: 'idle' }
const taskListeners = new Set<() => void>()
function setTaskStatus(next: TaskStatus): void {
  taskStatus = next
  for (const listener of [...taskListeners]) listener()
}
function subscribeTaskStatus(listener: () => void): () => void {
  taskListeners.add(listener)
  return () => { taskListeners.delete(listener) }
}
function useTaskStatus(): TaskStatus {
  return typeof React.useSyncExternalStore === 'function'
    ? React.useSyncExternalStore(subscribeTaskStatus, () => taskStatus)
    : { phase: 'idle' }
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout after ${ms}ms: ${label}`)), ms)
    promise.then(
      (value) => { clearTimeout(timer); resolve(value) },
      (reason) => { clearTimeout(timer); reject(reason) },
    )
  })
}

// ctx.sessions.create resolves to the new session id and THROWS on failure
// (SessionCreateError) — the SessionRuntime contract, not a result envelope.
type SessionsService = {
  create: (opts: { cwd?: string; workspaceId?: string }) => Promise<string>
  open: (sessionId: string) => void | Promise<void>
}

type WorkspaceService = {
  sessions?: { clear?: () => void }
  pickDirectory: () => Promise<string | null>
  createDirectory: (root: string, name: string) => Promise<string>
  archiveSession?: (sessionId: string) => void | Promise<void>
}

async function resolveRoot(): Promise<string> {
  try {
    const settings = await withTimeout(fetchSettings(), 1500, 'settings fetch')
    if (settings.rootDirectory) return settings.rootDirectory
  } catch { /* keep the yaml/config fallback */ }
  return fallbackRoot
}

async function autoCreateAndStart(workspaces: WorkspaceService | undefined, sessions: SessionsService | undefined): Promise<void> {
  if (!workspaces || !sessions) return
  setTaskStatus({ phase: 'busy' })
  try {
    const root = await resolveRoot()
    const trimmed = root.trim()
    if (!trimmed) throw new Error('rootDirectory 未配置')
    // Auto-clean unused temporary tasks (blank, non-current) before creating a
    // new one, so repeated starts never accumulate folders.
    try {
      await cleanupUnusedTemporaryTasks(workspaces, sessions, trimmed)
    } catch { /* cleanup is best-effort */ }
    console.log('[timestamp-workspace] creating temp task folder under', trimmed)
    const path = await withTimeout(workspaces.createDirectory(trimmed, formatTimestamp()), 20000, 'createDirectory')
    console.log('[timestamp-workspace] temp task folder ready:', path)
    const sessionId = await withTimeout(sessions.create({ cwd: path }), 20000, 'sessions.create')
    console.log('[timestamp-workspace] temp task session ready:', sessionId)
    await withTimeout(Promise.resolve(sessions.open(sessionId)), 20000, 'sessions.open')
    setTaskStatus({ phase: 'idle' })
  } catch (reason) {
    // Temp-task setup failed (no root configured, same-second conflict,
    // host rejection, timeout...): keep the current view and surface the
    // reason next to the hero button (visible without DevTools).
    const message = reason instanceof Error ? reason.message : String(reason)
    console.warn('[timestamp-workspace] temp task start failed:', reason)
    setTaskStatus({ phase: 'error', message })
  }
}

/** The hero button action: a temporary task needs no workspace pick. */
function startTemporaryTask(): void {
  if (runtime === null) return
  void autoCreateAndStart(
    runtime.workspaces as unknown as WorkspaceService | undefined,
    runtime.sessions as unknown as SessionsService | undefined,
  )
}

function TimestampSettingsSection(props: { close?: () => void }) {
  const [root, setRoot] = React.useState<string>('')
  const [loading, setLoading] = React.useState<boolean>(true)
  const [busy, setBusy] = React.useState<boolean>(false)
  const [error, setError] = React.useState<string | null>(null)
  const [saved, setSaved] = React.useState<boolean>(false)

  React.useEffect(() => {
    let alive = true
    fetchSettings()
      .then((settings) => { if (alive) { setRoot(settings.rootDirectory); setLoading(false) } })
      .catch((reason) => {
        if (!alive) return
        setError(reason instanceof Error ? reason.message : String(reason))
        setLoading(false)
      })
    return () => { alive = false }
  }, [])

  const persist = async (next: string) => {
    setBusy(true); setError(null); setSaved(false)
    try {
      await updateSettings(next)
      setRoot(next)
      setSaved(true)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  const pick = async () => {
    if (runtime === null || busy) return
    try {
      const picked = await runtime.workspaces.pickDirectory()
      if (picked) await persist(picked)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  const save = async () => {
    if (busy) return
    const trimmed = root.trim()
    if (!trimmed) { setError('rootDirectory 不能为空'); return }
    await persist(trimmed)
  }

  return React.createElement('div', { style: { padding: '4px 0', display: 'flex', flexDirection: 'column', gap: 12 } },
    React.createElement('p', { style: { margin: 0, fontSize: 13, opacity: 0.8 } },
      '开启临时会话时，将在此根目录下自动创建 YYYYMMDDHHmmss 命名的工作区文件夹。保存后立即生效，优先于 cordis.patch.yml 里的 rootDirectory 配置。'),
    loading
      ? React.createElement('p', { style: { margin: 0, fontSize: 13, opacity: 0.6 } }, '读取配置中…')
      : React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
          React.createElement('label', { style: { fontSize: 13, display: 'flex', flexDirection: 'column', gap: 4 } },
            '根目录（rootDirectory）',
            React.createElement('input', {
              value: root,
              disabled: busy,
              placeholder: '例如 C:/Users/yezac/Documents/dsh-workspaces',
              onChange: (event: React.ChangeEvent<HTMLInputElement>) => { setRoot(event.target.value); setSaved(false) },
              style: { padding: '6px 8px', borderRadius: 6, border: '1px solid rgba(128,128,128,0.35)', background: 'transparent', color: 'inherit', fontSize: 13 },
            })),
          React.createElement('div', { style: { display: 'flex', gap: 8 } },
            React.createElement('button', { disabled: busy, onClick: pick }, busy ? '处理中…' : '选择目录…'),
            React.createElement('button', { disabled: busy, onClick: save }, '保存')),
          error && React.createElement('div', { role: 'alert', style: { fontSize: 13, color: '#e5484d' } }, error),
          saved && React.createElement('div', { style: { fontSize: 13, color: '#30a46c' } }, '已保存')),
    props.close && React.createElement('button', { onClick: props.close }, '完成'))
}

/**
 * Host UI primitives (Modal, Button) resolve through the client-modules
 * require table at render time. The ESM test build (lib/client.mjs) never
 * calls this, so the bare `require` reference stays unexecuted there.
 */
let primitivesCache: any = null
function getPrimitives(): any {
  if (primitivesCache !== null) return primitivesCache
  const req = (globalThis as any).require ?? (typeof require === 'function' ? require : undefined)
  if (typeof req !== 'function') return (primitivesCache = {})
  try {
    primitivesCache = req('@deepseek-ai/dsh-client-ui-primitives')
  } catch {
    primitivesCache = {}
  }
  return primitivesCache
}

// Host icon glyphs (copied from dsh-client-ui-primitives icons) so injected
// menu rows and the batch dialog inherit the exact same iconography.
const ARCHIVE_ICON_SVG = '<svg width="16" height="16" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><path fillRule="evenodd" clipRule="evenodd" d="M15.8659 2.05975C17.2603 2.05995 18.3913 3.19096 18.3914 4.58527V5.4874C18.3914 6.02747 18.2192 6.52672 17.9303 6.93735C17.9336 6.96524 17.9388 6.99318 17.9388 7.02195V12.8884C17.9388 13.6345 17.9395 14.2379 17.8996 14.7254C17.8642 15.1593 17.7936 15.5499 17.6373 15.9141L17.5654 16.0685C17.278 16.6328 16.8405 17.1046 16.3038 17.434L16.0679 17.5661C15.66 17.7739 15.2196 17.8598 14.7237 17.9003C14.2362 17.9401 13.6327 17.9405 12.8867 17.9405H7.11122C6.36511 17.9405 5.76171 17.9401 5.27418 17.9003C4.84051 17.8649 4.44949 17.7952 4.08545 17.6391L3.93104 17.5661C3.36673 17.2785 2.89392 16.8414 2.56465 16.3044L2.43245 16.0685C2.22473 15.6608 2.13878 15.2211 2.09825 14.7254C2.05841 14.2379 2.05912 13.6345 2.05912 12.8884V7.02195C2.05912 6.99284 2.06422 6.96449 2.06758 6.93629C1.77931 6.52592 1.60858 6.02687 1.60858 5.4874V4.58527C1.60876 3.19084 2.73962 2.05975 4.1341 2.05975H15.8659ZM16.4984 7.92936C16.296 7.98169 16.0847 8.01288 15.8659 8.01291H4.1341C3.91478 8.01291 3.70246 7.98194 3.49955 7.92936V12.8884C3.49955 13.6582 3.50053 14.1927 3.53445 14.608C3.56769 15.0146 3.62923 15.244 3.71635 15.415L3.7925 15.5514C3.98339 15.8627 4.25749 16.1165 4.58464 16.2833L4.72529 16.3435C4.88095 16.3993 5.08638 16.4402 5.39158 16.4651C5.80685 16.4991 6.34138 16.5001 7.11122 16.5001H12.8867C13.6564 16.5001 14.1911 16.499 14.6063 16.4651C15.0128 16.432 15.2423 16.3703 15.4133 16.2833L15.5508 16.2061C15.8618 16.0152 16.116 15.7419 16.2827 15.415L16.3429 15.2732C16.3985 15.1177 16.4396 14.9128 16.4645 14.608C16.4985 14.1927 16.4984 13.6583 16.4984 12.8884V7.92936ZM4.1341 3.50019C3.53511 3.50019 3.0492 3.98631 3.04902 4.58527V5.4874C3.04902 6.08649 3.535 6.57248 4.1341 6.57248H15.8659C16.4648 6.57228 16.951 6.08638 16.951 5.4874V4.58527C16.9509 3.98644 16.4647 3.50038 15.8659 3.50019H4.1341Z" fill="currentColor"/><path d="M12.7962 12.5661V11.0832H7.20548V12.5661L12.7962 12.5661Z" fill="currentColor"/></svg>'
const CHECK_ICON_SVG = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M15.0498 3.92579L8.49512 12.3818C8.25774 12.6881 8.04517 12.9645 7.84668 13.1689C7.63957 13.3823 7.38732 13.5841 7.04492 13.6719C6.86373 13.7183 6.6757 13.7346 6.48926 13.7197C6.13666 13.6915 5.8528 13.5355 5.6123 13.3604C5.38201 13.1926 5.12573 12.9567 4.83984 12.6953L1.03125 9.21289L1.96875 8.1875L5.77734 11.6699C6.08684 11.9529 6.27773 12.1249 6.43066 12.2363C6.50183 12.2882 6.54699 12.3135 6.57324 12.3252C6.58525 12.3305 6.59269 12.3322 6.5957 12.333C6.59802 12.3336 6.59961 12.334 6.59961 12.334C6.63317 12.3367 6.66758 12.3335 6.7002 12.3252C6.7002 12.3252 6.70211 12.3251 6.7041 12.3242C6.70698 12.3229 6.71348 12.319 6.72461 12.3115C6.74849 12.2956 6.78843 12.2642 6.84961 12.2012C6.98138 12.0654 7.13957 11.8628 7.39648 11.5313L13.9502 3.07422L15.0498 3.92579Z" fill="currentColor"/></svg>'
const ELLIPSIS_ICON_SVG = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4.55146 8.00001C4.55146 8.63513 4.03659 9.15001 3.40146 9.15001C2.76634 9.15001 2.25146 8.63513 2.25146 8.00001C2.25146 7.36488 2.76634 6.85001 3.40146 6.85001C4.03659 6.85001 4.55146 7.36488 4.55146 8.00001Z" fill="currentColor"/><path d="M9.1476 8.00001C9.1476 8.63513 8.63273 9.15001 7.9976 9.15001C7.36248 9.15001 6.8476 8.63513 6.8476 8.00001C6.8476 7.36488 7.36248 6.85001 7.9976 6.85001C8.63273 6.85001 9.1476 7.36488 9.1476 8.00001Z" fill="currentColor"/><path d="M13.7486 8.00001C13.7486 8.63513 13.2338 9.15001 12.5986 9.15001C11.9635 9.15001 11.4486 8.63513 11.4486 8.00001C11.4486 7.36488 11.9635 6.85001 12.5986 6.85001C13.2338 6.85001 13.7486 7.36488 13.7486 8.00001Z" fill="currentColor"/></svg>'

async function requestCleanup(paths: string[]): Promise<boolean> {
  try {
    const res = await fetch('/api/timestamp-workspace/cleanup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ paths }),
    })
    const data = await res.json().catch(() => null)
    if (res.ok && data?.ok === true) return true
    throw new Error((data && typeof data.error === 'string' ? data.error : 'cleanup failed'))
  } catch (reason) {
    console.warn('[timestamp-workspace] cleanup failed:', reason)
    return false
  }
}

/** Archived blank temporary sessions (closed without content) drop their folders. */
let cleanupHandledArchives = new Set<string>()
function installCleanupOnArchive(workspaces: any, sessions: any): void {
  const sessionsList = sessions?.list
  const workspacesList = workspaces?.list
  if (!sessionsList?.subscribe || !workspacesList?.subscribe) return
  const scan = () => {
    const sessionState = sessionsList.getSnapshot?.()
    const workspaceState = workspacesList.getSnapshot?.()
    const archived = new Set<string>((workspaceState?.archivedSessionIds ?? []) as string[])
    const paths: string[] = []
    for (const id of archived) {
      if (cleanupHandledArchives.has(id)) continue
      const summary = sessionState?.byId?.[id]
      if (!summary?.cwd || summary.blank !== true || summary.origin === 'subagent') continue
      cleanupHandledArchives.add(id)
      paths.push(summary.cwd)
    }
    if (paths.length > 0) void requestCleanup(paths)
  }
  sessionsList.subscribe(scan)
  workspacesList.subscribe(scan)
}

/**
 * Collect and clean unused temporary tasks: blank, non-current sessions whose
 * cwd lives directly under rootDirectory. The host half deletes the folders;
 * the sessions are archived so they leave the ungrouped list.
 */
async function cleanupUnusedTemporaryTasks(workspaces: any, sessions: any, rootOverride?: string): Promise<number> {
  const sessionState = sessions?.list?.getSnapshot?.()
  const workspaceState = workspaces?.list?.getSnapshot?.()
  if (!sessionState || !workspaceState) return 0
  let root = rootOverride ?? ''
  if (root === '') {
    try {
      const settings = await withTimeout(fetchSettings(), 1500, 'settings fetch')
      root = settings.rootDirectory.trim()
    } catch { /* keep '' -> nothing matches */ }
  }
  if (root === '') return 0
  // Normalize both sides (forward slashes, lowercase) so the Windows cwd
  // (backslash) always matches the configured root (forward slash).
  const norm = (p: string) => p.split(String.fromCharCode(92)).join('/').replace(/\/+$/, '').toLowerCase()
  const rootKey = norm(root)
  const registered = new Set((workspaceState.items ?? []).flatMap((w: any) => w.sessionIds ?? []))
  const archived = new Set(workspaceState.archivedSessionIds ?? [])
  const targets: { sessionId: string; cwd: string }[] = []
  for (const id of sessionState.ids ?? []) {
    const summary = sessionState.byId?.[id]
    if (!summary?.cwd || !norm(summary.cwd).startsWith(rootKey + '/')) continue
    if (registered.has(id) || archived.has(id) || id === sessionState.current) continue
    if (summary.origin === 'subagent') continue
    if (summary.blank !== true) continue
    targets.push({ sessionId: id, cwd: summary.cwd })
  }
  if (targets.length === 0) return 0
  const ok = await requestCleanup(targets.map((target) => target.cwd))
  if (!ok) return 0
  const removedPaths = targets.map((target) => target.cwd)
  for (const target of targets) {
    try { await workspaces?.archiveSession?.(target.sessionId) } catch { /* archive is best-effort */ }
  }
  return removedPaths.length
}

/**
 * Keep the host InputBar entry, including its children declaration and inject
 * contract, and wrap only its component at runtime. This preserves the exact
 * native DOM, styles, attachments, model controls, keyboard handling, draft
 * machine, and submit behavior without registering a competing slot entry.
 */
function isTemporarySessionProps(props: any, sessions: unknown, workspaces: unknown): boolean {
  const sessionId = props.sessionId
  const sessionState = props.useSessions?.((state: any) => state) ?? (sessions as any)?.list?.getSnapshot?.()
  const workspaceState = props.useWorkspaces?.((state: any) => state) ?? (workspaces as any)?.list?.getSnapshot?.()
  const summary = sessionId === undefined ? undefined : sessionState?.byId?.[sessionId]
  const registered = sessionId !== undefined && (workspaceState?.items ?? []).some((item: any) => item.sessionIds?.includes(sessionId))
  return !!summary?.cwd && !registered
}

let nativeComposerEntry: any = null
let nativeComposerOriginal: any = null
function installNativeComposerOverride(slots: any, sessions: unknown, workspaces: unknown): void {
  const entries = slots?.entries?.('conversation.composer.bar') ?? []
  const entry = entries.find((candidate: any) => typeof candidate.component === 'function' && candidate !== nativeComposerEntry)
  if (!entry || nativeComposerEntry === entry) return
  nativeComposerEntry = entry
  nativeComposerOriginal = entry.component
  entry.component = (props: any) => {
    const temporary = isTemporarySessionProps(props, sessions, workspaces)
    const placeholder = props.placeholder === '选择一个工作区开始' || props.placeholder === 'Choose a workspace to start'
      ? '选择一个工作区或以临时会话开始'
      : props.placeholder
    return React.createElement(nativeComposerOriginal, {
      ...props,
      disabled: temporary ? false : props.disabled,
      placeholder,
    })
  }
}

/**
 * The hero's "choose a workspace" row (host ConversationRoot) renders the
 * conversation.hero.workspace slot next to the WorkspaceChip. We keep the host
 * entry (its root slot is owned and its directory-flow child is host-declared,
 * so a root replacement is impossible by design) and wrap only its component:
 * a "开启临时会话" button renders alongside the chip and starts a temporary
 * task directly, while the host picker keeps its native menu/add flow.
 */
let nativeWorkspacePickerEntry: any = null
let nativeWorkspacePickerOriginal: any = null

function HeroTempButton(props: { status: TaskStatus; onStart: () => void }) {
  const busy = props.status.phase === 'busy'
  return React.createElement('div', { style: { display: 'inline-flex', alignItems: 'center', minWidth: 0 } },
    React.createElement('button', {
      type: 'button',
      className: 'dsh-timestamp-hero-temp-button',
      title: '创建一个以当前时间命名目录的临时会话，无需选择工作区',
      disabled: busy,
      onClick: props.onStart,
    }, busy ? '创建中…' : '开启临时会话'),
    props.status.phase === 'error' && props.status.message
      ? React.createElement('span', { role: 'alert', className: 'dsh-timestamp-hero-temp-error' }, props.status.message)
      : null,
  )
}

function WorkspacePickerWrapper(props: any) {
  const status = useTaskStatus()
  return React.createElement(React.Fragment, null,
    React.createElement(HeroTempButton, { status, onStart: startTemporaryTask }),
    nativeWorkspacePickerOriginal === null ? null : React.createElement(nativeWorkspacePickerOriginal, props),
  )
}

function installWorkspacePickerOverride(slots: any): void {
  const entries = slots?.entries?.('conversation.hero.workspace') ?? []
  const entry = entries.find((candidate: any) => typeof candidate.component === 'function' && candidate !== nativeWorkspacePickerEntry)
  if (!entry || nativeWorkspacePickerEntry === entry) return
  nativeWorkspacePickerEntry = entry
  nativeWorkspacePickerOriginal = entry.component
  entry.component = (props: any) => React.createElement(WorkspacePickerWrapper, props)
}

/**
 * Multi-select archive dialog: first step lists the target sessions
 * (workspace members, or the ungrouped bucket when workspaceId is undefined),
 * second step is the explicit confirmation. Modal/Button are the host
 * primitives; rows use host design tokens only.
 */
export function BatchArchiveDialog(props: { workspaceId?: string | undefined; label: string; onClose: () => void }) {
  const { workspaceId, label, onClose } = props
  const prim = getPrimitives()
  const Modal = prim?.Modal
  const Button = prim?.Button
  const [selected, setSelected] = React.useState<ReadonlySet<string>>(new Set())
  const [step, setStep] = React.useState<'select' | 'confirm'>('select')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const workspaces = (runtime?.workspaces as any) ?? {}
  const sessions = (runtime?.sessions as any) ?? {}
  const sessionState = sessions?.list?.getSnapshot?.() ?? { byId: {} }
  const workspaceState = workspaces?.list?.getSnapshot?.() ?? { items: [], archivedSessionIds: [] }
  const archived = new Set<string>(workspaceState.archivedSessionIds ?? [])
  const workspace = workspaceId === undefined
    ? undefined
    : (workspaceState.items ?? []).find((w: any) => w.workspaceId === workspaceId)
  const titleOf = (summary: any, id: string): string =>
    summary?.blank === true ? '新会话' : (summary?.displayTitle ?? summary?.title ?? id)
  let rows: { id: string; title: string }[]
  if (workspace !== undefined) {
    rows = (workspace.sessionIds ?? [])
      .filter((id: string) => !archived.has(id))
      .map((id: string) => ({ id, title: titleOf(sessionState.byId?.[id], id) }))
  } else {
    // Ungrouped bucket: the same visible sessions as the sidebar group —
    // non-subagent, not archived, outside every workspace, and blank only
    // when it is the current session.
    const registered = new Set((workspaceState.items ?? []).flatMap((w: any) => w.sessionIds ?? []))
    rows = (sessionState.ids ?? [])
      .filter((id: string) => {
        const summary = sessionState.byId?.[id]
        if (summary?.origin === 'subagent') return false
        if (archived.has(id)) return false
        if (registered.has(id)) return false
        if (summary?.blank === true && id !== sessionState.current) return false
        return true
      })
      .map((id: string) => ({ id, title: titleOf(sessionState.byId?.[id], id) }))
  }
  const count = rows.length
  const chosen = [...selected].filter((id) => rows.some((row) => row.id === id)).length

  const toggle = (id: string): void => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const setAll = (on: boolean): void => {
    setSelected(on ? new Set(rows.map((row) => row.id)) : new Set())
  }

  const runArchive = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    const ids = [...selected]
    let failed = 0
    for (const id of ids) {
      try {
        await workspaces?.archiveSession?.(id)
      } catch (reason) {
        failed += 1
        console.warn('[timestamp-workspace] batch archive failed for', id, reason)
      }
    }
    setBusy(false)
    if (failed === 0) { onClose(); return }
    if (failed === ids.length) {
      setError('归档失败，请重试')
      return
    }
    // Partial success: the archived rows disappear on their own; close and
    // let the remaining selection speak for itself.
    onClose()
  }

  const rowStyle = (active: boolean): React.CSSProperties => ({
    display: 'flex', alignItems: 'center', gap: 8, width: '100%',
    padding: '7px 8px', borderRadius: 8, border: 'none',
    background: active ? 'var(--dsw-alias-interactive-bg-hover)' : 'transparent',
    color: active ? 'var(--dsw-alias-label-primary)' : 'var(--dsw-alias-label-secondary)',
    fontSize: 13, lineHeight: '18px', cursor: 'pointer', textAlign: 'left',
  })
  const checkStyle = (active: boolean): React.CSSProperties => ({
    flex: 'none', width: 16, height: 16, opacity: active ? 1 : 0,
    color: active ? 'var(--dsw-alias-label-primary)' : 'var(--dsw-alias-label-secondary)',
  })
  const linkStyle: React.CSSProperties = {
    border: 'none', background: 'transparent', padding: 0, fontSize: 12,
    color: 'var(--dsw-alias-label-primary)', cursor: 'pointer',
  }

  const selectBody = React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 8, minWidth: 340 } },
    React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12, color: 'var(--dsw-alias-label-secondary)' } },
      React.createElement('span', null, `已选 ${chosen} / ${count}`),
      React.createElement('div', { style: { display: 'flex', gap: 10 } },
        React.createElement('button', { type: 'button', disabled: busy, onClick: () => setAll(true), style: linkStyle }, '全选'),
        React.createElement('button', { type: 'button', disabled: busy, onClick: () => setAll(false), style: linkStyle }, '清空'),
      ),
    ),
    count === 0
      ? React.createElement('div', { style: { padding: '12px 8px', fontSize: 13, color: 'var(--dsw-alias-label-secondary)' } }, '该工作区没有可归档的会话')
      : React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 300, overflowY: 'auto' } },
          rows.map((row) => React.createElement('button', {
            key: row.id, type: 'button', disabled: busy, onClick: () => toggle(row.id),
            style: rowStyle(selected.has(row.id)),
          },
            React.createElement('span', { style: { flex: 1, minWidth: 0, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, row.title),
            React.createElement('span', { style: checkStyle(selected.has(row.id)), dangerouslySetInnerHTML: { __html: CHECK_ICON_SVG } }),
          )),
        ),
    error === null ? null : React.createElement('div', { role: 'alert', style: { fontSize: 13, color: 'var(--dsw-alias-state-error-primary)' } }, error),
  )

  const chosenRows = rows.filter((row) => selected.has(row.id))
  const confirmBody = React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 10, minWidth: 340 } },
    React.createElement('p', { style: { margin: 0, fontSize: 13, lineHeight: '20px' } },
      `确定归档选中的 ${chosen} 个会话吗？归档后它们会从侧边栏隐藏，会话日志保留，之后仍可恢复。`),
    React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 4, padding: '8px 10px', borderRadius: 8, border: '1px solid var(--dsw-alias-border-l3)', fontSize: 13, lineHeight: '20px', maxHeight: 200, overflowY: 'auto' } },
      chosenRows.map((row) => React.createElement('div', { key: row.id, style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, row.title)),
    ),
    error === null ? null : React.createElement('div', { role: 'alert', style: { fontSize: 13, color: 'var(--dsw-alias-state-error-primary)' } }, error),
  )

  const selectFooter = React.createElement(React.Fragment, null,
    React.createElement(Button, { variant: 'outline', disabled: busy, onClick: onClose }, '取消'),
    React.createElement(Button, { variant: 'primary', disabled: busy || chosen === 0, onClick: () => setStep('confirm') }, chosen > 0 ? `归档 ${chosen} 个` : '归档'),
  )
  const confirmFooter = React.createElement(React.Fragment, null,
    React.createElement(Button, { variant: 'outline', disabled: busy, onClick: () => setStep('select') }, '返回'),
    React.createElement(Button, { variant: 'primary', disabled: busy, onClick: () => void runArchive() }, busy ? '归档中…' : '确认归档'),
  )

  if (Modal === undefined || Button === undefined) {
    // Host without the primitives package: a bare fallback overlay keeps the
    // feature usable (still token-styled, no custom design language).
    return React.createElement('div', { style: { position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center' } },
      React.createElement('div', { role: 'dialog', style: { background: 'var(--dsw-alias-surface-bg-l1)', borderRadius: 12, padding: 16, minWidth: 340, maxWidth: 480 } },
        React.createElement('strong', null, `批量归档 · ${label}`),
        step === 'select' ? selectBody : confirmBody,
        React.createElement('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 } },
          React.createElement('button', { type: 'button', disabled: busy, onClick: step === 'select' ? onClose : () => setStep('select') }, step === 'select' ? '取消' : '返回'),
          React.createElement('button', { type: 'button', disabled: busy || chosen === 0, onClick: step === 'select' ? () => setStep('confirm') : () => void runArchive() },
            step === 'select' ? (chosen > 0 ? `归档 ${chosen} 个` : '归档') : (busy ? '归档中…' : '确认归档')),
        ),
      ),
    )
  }
  return React.createElement(Modal, {
    open: true,
    // The host Modal requires an onClose callback; while archiving, Escape or
    // mask clicks are ignored instead of closing mid-flight.
    onClose: busy ? () => {} : onClose,
    closeLabel: '关闭',
    title: `批量归档 · ${label}`,
    footer: step === 'select' ? selectFooter : confirmFooter,
  }, step === 'select' ? selectBody : confirmBody)
}

/**
 * Wrap the native WorkspaceBrowser and, after every committed render, detect
 * the ungrouped group by stable DOM signals (draggable="false" project row, no
 * workspace-actions button), pin it to the top of the tree, mark it, and give
 * its title the temporary badge. All inside our own subtree — no observers.
 */
function WorkspaceBrowserOrderWrapper(props: any) {
  const containerRef = React.useRef<HTMLDivElement | null>(null)
  const useLayout = React.useLayoutEffect ?? React.useEffect
  const [batchArchive, setBatchArchive] = React.useState<{ workspaceId?: string | undefined; label: string } | null>(null)
  const [ungroupedMenu, setUngroupedMenu] = React.useState<{ open: boolean } | null>(null)
  // Ungrouped session count per the official sessionVisible rule (tree.ts):
  // non-subagent, not archived, outside every workspace, and blank only when
  // it is current.
  const sessionState = props.useSessions?.((s: any) => s)
  const workspaceState = props.useWorkspaces?.((s: any) => s)
  let ungroupedCount = 0
  if (sessionState !== undefined && workspaceState !== undefined) {
    const registered = new Set((workspaceState.items ?? []).flatMap((w: any) => w.sessionIds ?? []))
    const archived = new Set(workspaceState.archivedSessionIds ?? [])
    ungroupedCount = (sessionState.ids ?? []).filter((id: string) => {
      const summary = sessionState.byId?.[id]
      if (summary === undefined || registered.has(id) || archived.has(id)) return false
      if (summary.origin === 'subagent') return false
      if (summary.blank === true && id !== sessionState.current) return false
      return true
    }).length
  }
  useLayout(() => {
    const container = containerRef.current
    if (container === null) return
    const tree = container.querySelector('[role="tree"]')
    if (tree === null) return
    for (const group of Array.from(tree.children)) {
      // The ungrouped project row is the group's first treeitem. Source
      // guarantees (tree.ts / Rows.tsx): draggable = drag !== undefined,
      // actions exist only for real workspaces, and its title text is the
      // localized 未分组/Ungrouped label. Multi-signal OR for robustness.
      const row = group.querySelector('[role="treeitem"]')
      if (row === null) continue
      const text = row.textContent ?? ''
      const isUngrouped = row.getAttribute('draggable') === 'false'
        || row.querySelector('[aria-label*="的操作"]') === null
        || (text.includes('未分组') && !text.includes('工作区“'))
      if (!isUngrouped) continue
      group.setAttribute('data-timestamp-ungrouped', '')
      const title = Array.from(row.querySelectorAll('span')).find((s) => {
        const value = (s.textContent ?? '').trim()
        return value === '未分组' || value === 'Ungrouped' || /^(未分组|Ungrouped)\s*\(\d+\)$/.test(value)
      })
      if (title !== undefined && ungroupedCount > 0) {
        const base = (title.textContent ?? '').replace(/\s*\(\d+\)\s*$/, '')
        const next = `${base} (${ungroupedCount})`
        if (title.textContent !== next) title.textContent = next
      }
      // Blank placeholder rows in the ungrouped bucket are the temporary
      // tasks started from the hero button; label them for clarity.
      for (const rowEl of Array.from(group.querySelectorAll('[role="treeitem"]'))) {
        const title = Array.from(rowEl.querySelectorAll('span')).find((s) => (s.textContent ?? '').trim() === '新会话')
        if (title !== undefined && title !== null) title.textContent = '新的临时会话'
      }
      // The ungrouped bucket has no host actions menu, so give it a "..."
      // button (host iconButton style, placed after the + button) that opens
      // our menu with 批量归档 for the temporary sessions.
      const plus = row.querySelector('button[aria-label*="新建会话"]')
      if (plus !== null) {
        let ellipsis = row.querySelector('button[data-timestamp-ungrouped-ellipsis]') as HTMLButtonElement | null
        if (ellipsis === null) {
          ellipsis = document.createElement('button')
          ellipsis.type = 'button'
          ellipsis.className = plus.className
          ellipsis.setAttribute('aria-label', '批量归档')
          ellipsis.setAttribute('data-timestamp-ungrouped-ellipsis', '')
          ellipsis.innerHTML = ELLIPSIS_ICON_SVG
          const actionsCell = plus.parentElement
          if (actionsCell !== null) {
            actionsCell.appendChild(ellipsis)
            ellipsis.addEventListener('click', (e) => {
              e.stopPropagation()
              setUngroupedMenu({ open: true })
            })
          }
        }
      }
      if (tree.firstElementChild !== group) tree.insertBefore(group, tree.firstElementChild)
    }
  })
  const MenuComp = getPrimitives()?.Menu
  return React.createElement('div', { ref: containerRef, style: { display: 'contents' } },
    React.createElement(nativeWorkspaceBrowserOriginal, props),
    ungroupedMenu !== null && MenuComp !== undefined
      ? React.createElement(MenuComp, {
          open: true,
          anchor: null,
          items: [{ id: 'batch-archive', label: '批量归档', icon: React.createElement('span', { dangerouslySetInnerHTML: { __html: ARCHIVE_ICON_SVG } }) }],
          onSelect: (id: string) => {
            setUngroupedMenu(null)
            if (id === 'batch-archive') setBatchArchive({ workspaceId: undefined, label: '未分组' })
          },
          onClose: () => setUngroupedMenu(null),
          portal: true,
          closeOnPointerLeave: true,
          getAnchorRect: () => {
            const btn = containerRef.current?.querySelector('button[data-timestamp-ungrouped-ellipsis]')
            return btn !== null && btn !== undefined ? btn.getBoundingClientRect() : null
          },
        })
      : null,
    batchArchive === null ? null : React.createElement(BatchArchiveDialog, {
      workspaceId: batchArchive.workspaceId,
      label: batchArchive.label,
      onClose: () => setBatchArchive(null),
    }))
}

let nativeWorkspaceBrowserEntry: any = null
let nativeWorkspaceBrowserOriginal: any = null
const UNGROUPED_STYLE_ID = 'dsh-timestamp-workspace-ungrouped-style'
function installUngroupedStyle(): void {
  if (typeof document === 'undefined' || document.getElementById(UNGROUPED_STYLE_ID) !== null) return
  const style = document.createElement('style')
  style.id = UNGROUPED_STYLE_ID
  style.textContent = [
    '[data-timestamp-ungrouped]{font-style:italic;border:1px dashed var(--dsw-alias-border-l3);border-radius:12px;margin:0;padding:2px}',
    '.dsh-timestamp-hero-temp-button{display:inline-flex;align-items:center;gap:4px;min-height:28px;margin-left:8px;padding:0 12px;border:1px solid var(--dsw-alias-border-l3);border-radius:16px;background:transparent;color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px;font-weight:500;cursor:pointer;white-space:nowrap}',
    '.dsh-timestamp-hero-temp-button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}',
    '.dsh-timestamp-hero-temp-button:disabled{opacity:.6;cursor:default}',
    '.dsh-timestamp-hero-temp-error{font-size:12px;line-height:16px;color:var(--dsw-alias-state-error-primary);margin-left:8px}',
  ].join('\n')
  document.head.appendChild(style)
}
function installWorkspaceBrowserOverride(slots: any): void {
  const entries = slots?.entries?.('sidebar.workspaces') ?? []
  const entry = entries.find((candidate: any) => typeof candidate.component === 'function' && candidate !== nativeWorkspaceBrowserEntry)
  if (!entry || nativeWorkspaceBrowserEntry === entry) return
  nativeWorkspaceBrowserEntry = entry
  nativeWorkspaceBrowserOriginal = entry.component
  installUngroupedStyle()
  entry.component = (props: any) => React.createElement(WorkspaceBrowserOrderWrapper, props)
}

export function apply(ctx: ClientContext, config?: Config): void {
  runtime = ctx
  fallbackRoot = config?.rootDirectory ?? ''
  const workspaces = ctx.workspaces as unknown as WorkspaceService | undefined
  const sessions = ctx.sessions as unknown as SessionsService | undefined

  // New Session stays the host's original flow (choose a workspace). The
  // plugin only adds the hero "开启临时会话" button next to the picker chip.
  installWorkspacePickerOverride(ctx.slots)
  // Temporary (cwd-only, ungrouped) sessions have no workspace chip, so the
  // host would lock their composer; unlock exactly those sessions in place.
  installNativeComposerOverride(ctx.slots, sessions, workspaces)
  installWorkspaceBrowserOverride(ctx.slots)
  installCleanupOnArchive(workspaces, sessions)
  // Settings-panel section (same recipe as deepseek-harness-wallet): a row
  // in the host Settings shell that reads/writes the rootDirectory through
  // the plugin's own fenced route. Guarded so older hosts without the
  // settings section slot keep loading the plugin.
  if (ctx.slots && typeof ctx.slots.inject === 'function') {
    try {
      ;(ctx.slots as unknown as { inject: (name: string, factory: () => unknown) => unknown; register: (desc: Record<string, unknown>, component: unknown) => unknown }).inject('settings.section', () => (ctx.slots as unknown as { register: (desc: Record<string, unknown>, component: unknown) => unknown }).register({
        name: 'settings.section',
        id: 'timestamp-workspace',
        order: 60,
        label: () => '时间戳工作区',
        inject: () => ({}),
      }, TimestampSettingsSection))
    } catch { /* host without the settings section slot */ }
  }
}
