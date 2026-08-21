import * as React from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { DirectoryFlowOwnerProps } from '@deepseek-ai/dsh-client-ui-workspace/client'

export const name = 'timestamp-workspace-client'
export const inject = ['slots', 'workspaces']
export interface Config { rootDirectory: string }

export function formatTimestamp(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return String(date.getFullYear()) + pad(date.getMonth() + 1) + pad(date.getDate()) + pad(date.getHours()) + pad(date.getMinutes()) + pad(date.getSeconds())
}

export async function createTimestampWorkspace(createDirectory: (root: string, name: string) => Promise<string>, rootDirectory: string, date = new Date()): Promise<string> {
  const root = rootDirectory.trim()
  if (!root) throw new Error('rootDirectory 未配置')
  return createDirectory(root, formatTimestamp(date))
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

// The host resolves a parameterless startSession (top-bar / hero "new
// conversation") as `currentWorkspaceId ?? recentWorkspaceId`, so a fresh
// conversation silently inherits the last-used folder. That is a host
// default no slot can reach, so we shadow the method on the live service
// object: a parameterless New Session now clears into the workspace-less
// New Session view (the user picks a folder when they actually want one).
// Explicit workspace targets (per-workspace New Session in the sidebar)
// still run the original host logic. Guarded by a module-level flag so a
// hot reload (apply re-run) does not double-wrap.
let originalStartSession: ((workspaceId?: string) => void) | null = null

// The host's startInitialSelection runs synchronously inside the runtime
// apply — before this plugin — and subscribes to the workspace projection,
// waiting for the first ready baseline. Its only trigger is the projected
// recentWorkspaceId: booting with no restored current session auto-connects
// the last-used workspace, with no reachable handle to cancel that pending
// reconcile. So we shadow the projection instead: masking recentWorkspaceId
// on the very first ready baseline makes the reconcile settle as "done"
// without connecting, landing startup on the workspace-less New Session
// view — consistent with the startSession policy above. One-shot (the
// reconcile settles exactly once), guarded so hot reload does not re-wrap.
let startupMaskInstalled = false
function suppressStartupAutoSelection(workspaces: unknown): void {
  if (startupMaskInstalled) return
  const ws = workspaces as {
    list?: { set?: (next: Record<string, unknown>) => unknown }
    sessions?: { list?: { getSnapshot?: () => { current?: unknown } } }
  } | undefined
  const list = ws?.list
  const set = list?.set
  const sessionsList = ws?.sessions?.list
  if (!list || typeof set !== 'function' || !sessionsList || typeof sessionsList.getSnapshot !== 'function') return
  startupMaskInstalled = true
  list.set = (next: Record<string, unknown>): unknown => {
    if (next.baselinesReady === true) {
      // One-shot: the startup reconcile settles on the first ready
      // projection, so restore the original setter right away.
      list.set = set
      if (sessionsList.getSnapshot().current === undefined && next.recentWorkspaceId !== undefined) {
        next = { ...next, recentWorkspaceId: undefined }
      }
    }
    return set(next)
  }
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
      '自动创建的时间戳工作区将生成在此根目录下（YYYYMMDDHHmmss 命名）。保存后立即生效，优先于 cordis.patch.yml 里的 rootDirectory 配置。'),
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

function Flow(props: { owner: DirectoryFlowOwnerProps; pick: () => Promise<string | null>; create: (root: string, name: string) => Promise<string>; root: string }) {
  const { owner, pick, create, root } = props
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [rootDir, setRootDir] = React.useState<string>(root)
  const run = async (operation: () => Promise<string | null>) => {
    if (busy) return
    setBusy(true); setError(null)
    try { const path = await operation(); path ? owner.onPicked(path) : owner.onCancel() }
    catch (reason) { const message = reason instanceof Error ? reason.message : String(reason); setError(message); owner.onError(message) }
    finally { setBusy(false) }
  }
  // Re-resolve the root on every open so a settings-panel change takes
  // effect without a reload; fall back to the yaml value on failure.
  React.useEffect(() => {
    if (!owner.open) return
    let alive = true
    fetchSettings()
      .then((settings) => { if (alive && settings.rootDirectory) setRootDir(settings.rootDirectory) })
      .catch(() => { /* keep the yaml fallback */ })
    return () => { alive = false }
  }, [owner.open])
  if (!owner.open) return null
  return React.createElement('div', { role: 'dialog', 'aria-label': 'Workspace creation', style: { padding: 16, minWidth: 320 } },
    React.createElement('strong', null, '选择工作区'),
    React.createElement('p', null, '可以选择已有目录；也可以自动创建按当前时间命名的新工作区。'),
    error && React.createElement('div', { role: 'alert', style: { color: '#b42318' } }, error),
    React.createElement('button', { disabled: busy, onClick: () => run(pick) }, busy ? '处理中…' : '选择已有工作区'),
    React.createElement('button', { disabled: busy, onClick: () => run(() => createTimestampWorkspace(create, rootDir)) }, '自动创建时间戳工作区'),
    React.createElement('button', { disabled: busy, onClick: owner.onCancel }, '取消'))
}

export function apply(ctx: ClientContext, config: Config): void {
  runtime = ctx
  const workspaces = ctx.workspaces as unknown as {
    startSession?: (workspaceId?: string) => void
    sessions?: { clear?: () => void }
  } | undefined
  if (workspaces && typeof workspaces.startSession === 'function' && originalStartSession === null) {
    originalStartSession = workspaces.startSession.bind(workspaces)
    workspaces.startSession = (workspaceId?: string): void => {
      if (workspaceId === undefined) {
        try { workspaces.sessions?.clear?.() } catch { /* keep the current view */ }
        return
      }
      originalStartSession!(workspaceId)
    }
  }
  suppressStartupAutoSelection(ctx.workspaces)
  const occupant = (owner: DirectoryFlowOwnerProps) => React.createElement(Flow, { owner, pick: () => ctx.workspaces.pickDirectory(), create: (root, name) => ctx.workspaces.createDirectory(root, name), root: config.rootDirectory })
  const injected = () => ({})
  // The host (x6) already holds a priority-0 registration on both single
  // directory-flow holes; register at a lower priority to shadow it
  // (ascending priority, lowest renders).
  ctx.slots.inject('conversation.hero.workspace.directoryFlow', () => ctx.slots.inject('sidebar.workspaces.directoryFlow', function* () {
    yield ctx.slots.register({ name: 'conversation.hero.workspace.directoryFlow', inject: injected, priority: -1 }, occupant)
    yield ctx.slots.register({ name: 'sidebar.workspaces.directoryFlow', inject: injected, priority: -1 }, occupant)
  }))

  // Settings-panel section (same recipe as deepseek-harness-wallet): a row
  // in the host Settings shell that reads/writes the rootDirectory through
  // the plugin's own fenced route. Guarded so older hosts without the
  // settings section slot keep loading the plugin.
  if (ctx.slots && typeof ctx.slots.inject === 'function') {
    try {
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'timestamp-workspace',
        order: 60,
        label: () => '时间戳工作区',
        inject: () => ({}),
      }, TimestampSettingsSection))
    } catch { /* host without the settings section slot */ }
  }
}
