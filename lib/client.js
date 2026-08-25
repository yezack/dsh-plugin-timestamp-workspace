/* dsh-plugin-timestamp-workspace client half
 * Built by scripts/build-client.mjs from src/client.ts into the
 * client-modules contract (classic script; loader id = package name).
 * Do not edit by hand. */
window.__ModuleLoader__.load({
  id: "dsh-plugin-timestamp-workspace",
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    "use strict";
    var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
        if (k2 === undefined) k2 = k;
        var desc = Object.getOwnPropertyDescriptor(m, k);
        if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
          desc = { enumerable: true, get: function() { return m[k]; } };
        }
        Object.defineProperty(o, k2, desc);
    }) : (function(o, m, k, k2) {
        if (k2 === undefined) k2 = k;
        o[k2] = m[k];
    }));
    var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
        Object.defineProperty(o, "default", { enumerable: true, value: v });
    }) : function(o, v) {
        o["default"] = v;
    });
    var __importStar = (this && this.__importStar) || (function () {
        var ownKeys = function(o) {
            ownKeys = Object.getOwnPropertyNames || function (o) {
                var ar = [];
                for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
                return ar;
            };
            return ownKeys(o);
        };
        return function (mod) {
            if (mod && mod.__esModule) return mod;
            var result = {};
            if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
            __setModuleDefault(result, mod);
            return result;
        };
    })();
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.inject = exports.name = void 0;
    exports.formatTimestamp = formatTimestamp;
    exports.createTimestampWorkspace = createTimestampWorkspace;
    exports.apply = apply;
    const React = __importStar(require("react"));
    exports.name = 'timestamp-workspace-client';
    exports.inject = ['slots', 'workspaces', 'sessions'];
    function formatTimestamp(date = new Date()) {
        const pad = (n) => String(n).padStart(2, '0');
        return String(date.getFullYear()) + pad(date.getMonth() + 1) + pad(date.getDate()) + pad(date.getHours()) + pad(date.getMinutes()) + pad(date.getSeconds());
    }
    async function createTimestampWorkspace(createDirectory, rootDirectory, date = new Date()) {
        const root = rootDirectory.trim();
        if (!root)
            throw new Error('rootDirectory 未配置');
        return createDirectory(root, formatTimestamp(date));
    }
    /** The plugin's own fenced settings route (host half serves it). */
    const SETTINGS_URL = '/api/timestamp-workspace/settings';
    async function fetchSettings() {
        const res = await fetch(SETTINGS_URL);
        if (!res.ok)
            throw new Error(`settings fetch failed: ${res.status}`);
        return res.json();
    }
    async function updateSettings(rootDirectory) {
        const res = await fetch(SETTINGS_URL, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ rootDirectory }),
        });
        if (!res.ok) {
            const data = await res.json().catch(() => null);
            throw new Error((data && typeof data.error === 'string' && data.error) || `settings update failed: ${res.status}`);
        }
    }
    // The settings section component renders inside the host settings shell,
    // outside the directory-flow render tree, so it reaches the host APIs
    // through the apply-time context captured here.
    let runtime = null;
    // The host resolves a parameterless startSession (top-bar / hero "new
    // conversation") as `currentWorkspaceId ?? recentWorkspaceId`, so a fresh
    // conversation silently inherits the last-used folder. That is a host
    // default no slot can reach, so we shadow the method on the live service
    // object: a parameterless New Session now starts a temporary task — a
    // timestamp folder under the configured root (`rootDirectory/yyyyMMddHHmmss`)
    // plus an ungrouped session bound to that cwd, NOT registered as a
    // workspace. The host blocks composer input while no session exists, so
    // this is what keeps the "don't pick, just chat" flow usable. Explicit
    // workspace targets (per-workspace New Session in the sidebar) still run
    // the original host logic. Guarded by a module-level flag so a hot reload
    // (apply re-run) does not double-wrap.
    let originalStartSession = null;
    let autoCreating = false;
    let taskStatus = { phase: 'idle' };
    const taskListeners = new Set();
    function setTaskStatus(next) {
        taskStatus = next;
        for (const listener of [...taskListeners])
            listener();
    }
    function subscribeTaskStatus(listener) {
        taskListeners.add(listener);
        return () => { taskListeners.delete(listener); };
    }
    function useTaskStatus() {
        return typeof React.useSyncExternalStore === 'function'
            ? React.useSyncExternalStore(subscribeTaskStatus, () => taskStatus)
            : { phase: 'idle' };
    }
    function withTimeout(promise, ms, label) {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error(`timeout after ${ms}ms: ${label}`)), ms);
            promise.then((value) => { clearTimeout(timer); resolve(value); }, (reason) => { clearTimeout(timer); reject(reason); });
        });
    }
    async function resolveRoot(fallbackRoot) {
        try {
            const settings = await withTimeout(fetchSettings(), 1500, 'settings fetch');
            if (settings.rootDirectory)
                return settings.rootDirectory;
        }
        catch { /* keep the yaml/config fallback */ }
        return fallbackRoot;
    }
    async function autoCreateAndStart(workspaces, sessions, fallbackRoot) {
        if (autoCreating || !workspaces || !sessions)
            return;
        autoCreating = true;
        setTaskStatus({ phase: 'busy' });
        try {
            const root = await resolveRoot(fallbackRoot);
            const trimmed = root.trim();
            if (!trimmed)
                throw new Error('rootDirectory 未配置');
            console.log('[timestamp-workspace] new conversation: creating temp task folder under', trimmed);
            const path = await withTimeout(workspaces.createDirectory(trimmed, formatTimestamp()), 20000, 'createDirectory');
            console.log('[timestamp-workspace] temp task folder ready:', path);
            const sessionId = await withTimeout(sessions.create({ cwd: path }), 20000, 'sessions.create');
            console.log('[timestamp-workspace] temp task session ready:', sessionId);
            await withTimeout(Promise.resolve(sessions.open(sessionId)), 20000, 'sessions.open');
            setTaskStatus({ phase: 'idle' });
        }
        catch (reason) {
            // Temp-task setup failed (no root configured, same-second conflict,
            // host rejection, timeout...): fall back to the workspace-less view and
            // surface the reason in the hero state row (visible without DevTools).
            const message = reason instanceof Error ? reason.message : String(reason);
            console.warn('[timestamp-workspace] temp task start failed, staying blank:', reason);
            setTaskStatus({ phase: 'error', message });
            clearWorkspaceSelection(workspaces ?? {});
        }
        finally {
            autoCreating = false;
        }
    }
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
    let startupMaskInstalled = false;
    function suppressStartupAutoSelection(workspaces) {
        if (startupMaskInstalled)
            return;
        const ws = workspaces;
        const list = ws?.list;
        const set = list?.set;
        const sessionsList = ws?.sessions?.list;
        const getSessionSnapshot = sessionsList?.getSnapshot;
        if (!list || typeof set !== 'function' || !sessionsList || typeof getSessionSnapshot !== 'function')
            return;
        startupMaskInstalled = true;
        list.set = (next) => {
            if (next.baselinesReady === true) {
                // One-shot: the startup reconcile settles on the first ready
                // projection, so restore the original setter right away.
                list.set = set;
                if (getSessionSnapshot()?.current === undefined && next.recentWorkspaceId !== undefined) {
                    next = { ...next, recentWorkspaceId: undefined };
                }
            }
            return set(next);
        };
    }
    function TimestampSettingsSection(props) {
        const [root, setRoot] = React.useState('');
        const [loading, setLoading] = React.useState(true);
        const [busy, setBusy] = React.useState(false);
        const [error, setError] = React.useState(null);
        const [saved, setSaved] = React.useState(false);
        React.useEffect(() => {
            let alive = true;
            fetchSettings()
                .then((settings) => { if (alive) {
                setRoot(settings.rootDirectory);
                setLoading(false);
            } })
                .catch((reason) => {
                if (!alive)
                    return;
                setError(reason instanceof Error ? reason.message : String(reason));
                setLoading(false);
            });
            return () => { alive = false; };
        }, []);
        const persist = async (next) => {
            setBusy(true);
            setError(null);
            setSaved(false);
            try {
                await updateSettings(next);
                setRoot(next);
                setSaved(true);
            }
            catch (reason) {
                setError(reason instanceof Error ? reason.message : String(reason));
            }
            finally {
                setBusy(false);
            }
        };
        const pick = async () => {
            if (runtime === null || busy)
                return;
            try {
                const picked = await runtime.workspaces.pickDirectory();
                if (picked)
                    await persist(picked);
            }
            catch (reason) {
                setError(reason instanceof Error ? reason.message : String(reason));
            }
        };
        const save = async () => {
            if (busy)
                return;
            const trimmed = root.trim();
            if (!trimmed) {
                setError('rootDirectory 不能为空');
                return;
            }
            await persist(trimmed);
        };
        return React.createElement('div', { style: { padding: '4px 0', display: 'flex', flexDirection: 'column', gap: 12 } }, React.createElement('p', { style: { margin: 0, fontSize: 13, opacity: 0.8 } }, '自动创建的时间戳工作区将生成在此根目录下（YYYYMMDDHHmmss 命名）。保存后立即生效，优先于 cordis.patch.yml 里的 rootDirectory 配置。'), loading
            ? React.createElement('p', { style: { margin: 0, fontSize: 13, opacity: 0.6 } }, '读取配置中…')
            : React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } }, React.createElement('label', { style: { fontSize: 13, display: 'flex', flexDirection: 'column', gap: 4 } }, '根目录（rootDirectory）', React.createElement('input', {
                value: root,
                disabled: busy,
                placeholder: '例如 C:/Users/yezac/Documents/dsh-workspaces',
                onChange: (event) => { setRoot(event.target.value); setSaved(false); },
                style: { padding: '6px 8px', borderRadius: 6, border: '1px solid rgba(128,128,128,0.35)', background: 'transparent', color: 'inherit', fontSize: 13 },
            })), React.createElement('div', { style: { display: 'flex', gap: 8 } }, React.createElement('button', { disabled: busy, onClick: pick }, busy ? '处理中…' : '选择目录…'), React.createElement('button', { disabled: busy, onClick: save }, '保存')), error && React.createElement('div', { role: 'alert', style: { fontSize: 13, color: '#e5484d' } }, error), saved && React.createElement('div', { style: { fontSize: 13, color: '#30a46c' } }, '已保存')), props.close && React.createElement('button', { onClick: props.close }, '完成'));
    }
    function clearWorkspaceSelection(workspaces) {
        try {
            workspaces.sessions?.clear?.();
        }
        catch { /* keep the current view */ }
    }
    /** Single path segment, host-style display label for a cwd. */
    function workspaceLabel(path) {
        const trimmed = path.replace(/[\\/]+$/, '');
        const parts = trimmed.split(/[\\/]/);
        return parts[parts.length - 1] || trimmed;
    }
    /**
     * Current session's workspace, projected from the workspace list store.
     * Temporary (ungrouped) task sessions have no registered workspace, so
     * fall back to labeling them with their cwd folder name.
     */
    function useCurrentWorkspace(workspaces) {
        const list = workspaces?.list;
        const sessions = workspaces?.sessions?.list;
        const usable = typeof React.useSyncExternalStore === 'function'
            && !!list?.getSnapshot && typeof list.subscribe === 'function'
            && !!sessions?.getSnapshot && typeof sessions.subscribe === 'function';
        // Hooks are called unconditionally; the store identity is stable per apply,
        // so the usable flag cannot flip between renders.
        const projection = usable
            ? React.useSyncExternalStore((listener) => list.subscribe(listener), () => list.getSnapshot())
            : undefined;
        const session = usable
            ? React.useSyncExternalStore((listener) => sessions.subscribe(listener), () => sessions.getSnapshot())
            : undefined;
        if (!projection || !session)
            return {};
        const currentId = session?.current;
        const current = projection?.items?.find((item) => currentId !== undefined && item.sessionIds?.includes(currentId));
        if (current)
            return { selectedId: current.workspaceId, selectedTitle: current.title };
        const summary = currentId !== undefined ? session?.byId?.[currentId] : undefined;
        if (summary?.cwd)
            return { selectedTitle: workspaceLabel(summary.cwd) };
        return {};
    }
    function FlowDialog(props) {
        return React.createElement('div', { role: 'dialog', 'aria-label': 'Workspace creation', style: { padding: 16, minWidth: 320 } }, React.createElement('strong', null, '选择工作区'), props.stateLine, props.status?.phase === 'busy' && React.createElement('div', { role: 'status', style: { fontSize: 12, opacity: 0.7 } }, '正在创建临时任务…'), props.status?.phase === 'error' && React.createElement('div', { role: 'alert', style: { fontSize: 12, color: '#e5484d' } }, `临时任务创建失败：${props.status.message}`), React.createElement('p', null, '可以选择已有目录；也可以自动创建按当前时间命名的新工作区。'), props.error && React.createElement('div', { role: 'alert', style: { color: '#b42318' } }, props.error), React.createElement('button', { disabled: props.busy, onClick: props.onPick }, props.busy ? '处理中…' : '选择已有工作区'), React.createElement('button', { disabled: props.busy, onClick: props.onCreate }, '自动创建时间戳工作区'), React.createElement('button', { disabled: props.busy, onClick: props.onCancel }, '取消'));
    }
    function FlowDialogHost(props) {
        const { owner, pick, create, root, workspaces } = props;
        const [busy, setBusy] = React.useState(false);
        const [error, setError] = React.useState(null);
        const [rootDir, setRootDir] = React.useState(root);
        const run = async (operation) => {
            if (busy)
                return;
            setBusy(true);
            setError(null);
            try {
                const path = await operation();
                path ? owner.onPicked(path) : owner.onCancel();
            }
            catch (reason) {
                const message = reason instanceof Error ? reason.message : String(reason);
                setError(message);
                owner.onError(message);
            }
            finally {
                setBusy(false);
            }
        };
        // Re-resolve the root on every open so a settings-panel change takes
        // effect without a reload; fall back to the yaml value on failure.
        React.useEffect(() => {
            if (!owner.open)
                return;
            let alive = true;
            fetchSettings()
                .then((settings) => { if (alive && settings.rootDirectory)
                setRootDir(settings.rootDirectory); })
                .catch(() => { });
            return () => { alive = false; };
        }, [owner.open]);
        const selection = useCurrentWorkspace(workspaces);
        const stateLine = selection.selectedId !== undefined || selection.selectedTitle !== undefined
            ? React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 } }, React.createElement('span', { style: { fontSize: 13 } }, `工作区：${selection.selectedTitle || selection.selectedId}`), React.createElement('button', {
                type: 'button',
                'aria-label': '取消当前工作区',
                title: '取消当前工作区',
                onClick: () => clearWorkspaceSelection(workspaces ?? {}),
                style: { width: 22, height: 22, padding: 0, border: 0, borderRadius: 4, background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: 14, lineHeight: '22px' },
            }, '×'))
            : null;
        return FlowDialog({
            busy,
            error,
            stateLine,
            status: useTaskStatus(),
            onPick: () => run(pick),
            onCreate: () => run(() => createTimestampWorkspace(create, rootDir)),
            onCancel: owner.onCancel,
        });
    }
    /**
     * Hero occupant: renders only the directory creation dialog when the flow is
     * open. Closed state renders nothing — the host's workspace chip owns that
     * area, and a parallel state row would just duplicate it (the slot engine
     * also forbids replacing the host picker root).
     */
    function HeroFlow(props) {
        const { owner, workspaces } = props;
        if (!owner.open)
            return null;
        return React.createElement(FlowDialogHost, { owner, pick: props.pick, create: props.create, root: props.root, workspaces });
    }
    /** Sidebar occupant: creation dialog only (no state row in the sidebar). */
    function SidebarFlow(props) {
        if (!props.owner.open)
            return null;
        return React.createElement(FlowDialogHost, { owner: props.owner, pick: props.pick, create: props.create, root: props.root, workspaces: props.workspaces });
    }
    /**
     * Keep the host InputBar entry, including its children declaration and inject
     * contract, and wrap only its component at runtime. This preserves the exact
     * native DOM, styles, attachments, model controls, keyboard handling, draft
     * machine, and submit behavior without registering a competing slot entry.
     */
    let nativeComposerEntry = null;
    let nativeComposerOriginal = null;
    function isTemporarySessionProps(props, sessions, workspaces) {
        const sessionId = props.sessionId;
        const sessionState = props.useSessions?.((state) => state) ?? sessions?.list?.getSnapshot?.();
        const workspaceState = props.useWorkspaces?.((state) => state) ?? workspaces?.list?.getSnapshot?.();
        const summary = sessionId === undefined ? undefined : sessionState?.byId?.[sessionId];
        const registered = sessionId !== undefined && (workspaceState?.items ?? []).some((item) => item.sessionIds?.includes(sessionId));
        return !!summary?.cwd && !registered;
    }
    function installNativeComposerOverride(slots, sessions, workspaces) {
        const entries = slots?.entries?.('conversation.composer.bar') ?? [];
        const entry = entries.find((candidate) => typeof candidate.component === 'function' && candidate !== nativeComposerEntry);
        if (!entry || nativeComposerEntry === entry)
            return;
        nativeComposerEntry = entry;
        nativeComposerOriginal = entry.component;
        entry.component = (props) => {
            const temporary = isTemporarySessionProps(props, sessions, workspaces);
            return React.createElement(nativeComposerOriginal, {
                ...props,
                disabled: temporary ? false : props.disabled,
                placeholder: temporary ? '选择一个工作区或直接开始临时对话' : props.placeholder,
            });
        };
    }
    /** Mount a task-board-style top-level temporary conversation section. */
    function mountTemporaryConversationSection(sessions, workspaces) {
        if (typeof document === 'undefined')
            return () => { };
        const style = document.createElement('style');
        style.dataset.timestampWorkspaceSidebar = '';
        style.textContent = `
    [data-timestamp-temp-section]{box-sizing:border-box;flex:none;margin:0 8px 8px;padding:4px 2px 8px;border-bottom:1px solid var(--dsw-alias-border-l1)}
    [data-timestamp-temp-title]{height:28px;padding:0 8px;display:flex;align-items:center;color:var(--dsw-alias-label-tertiary);font-size:12px;font-weight:600}
    [data-timestamp-temp-list]{display:flex;flex-direction:column;gap:2px;max-height:168px;overflow:auto}
    [data-timestamp-temp-session]{box-sizing:border-box;width:100%;height:32px;padding:0 8px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);display:flex;align-items:center;gap:8px;text-align:left;cursor:pointer;font:inherit}
    [data-timestamp-temp-session]:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
    [data-timestamp-temp-session][data-active]{background:var(--dsw-alias-interactive-bg-active);color:var(--dsw-alias-label-primary)}
    [data-timestamp-temp-label]{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px}
    [data-sidebar-collapsed] [data-timestamp-temp-section]{display:none}
    `;
        document.head.appendChild(style);
        const section = document.createElement('section');
        section.setAttribute('data-timestamp-temp-section', '');
        const title = document.createElement('div');
        title.setAttribute('data-timestamp-temp-title', '');
        title.textContent = '临时对话';
        const list = document.createElement('div');
        list.setAttribute('data-timestamp-temp-list', '');
        section.append(title, list);
        let root = null;
        const findRoot = () => {
            const column = document.querySelector('[data-pane="sidebar"], [class*="sidebarCol"]');
            return column?.querySelector('[class*="logoRow"]')?.parentElement ?? column?.firstElementChild ?? null;
        };
        const render = () => {
            root ?? (root = findRoot());
            const region = root?.querySelector('[class*="regionArea"]');
            if (root !== null && region && section.parentElement !== root)
                root.insertBefore(section, region);
            const sessionState = sessions?.list?.getSnapshot?.();
            const workspaceState = workspaces?.list?.getSnapshot?.();
            const registered = new Set((workspaceState?.items ?? []).flatMap((item) => item.sessionIds ?? []));
            const archived = new Set(workspaceState?.archivedSessionIds ?? []);
            list.replaceChildren();
            for (const id of sessionState?.ids ?? []) {
                const summary = sessionState.byId?.[id];
                if (!summary?.cwd || registered.has(id) || archived.has(id))
                    continue;
                const button = document.createElement('button');
                button.type = 'button';
                button.setAttribute('data-timestamp-temp-session', '');
                if (id === sessionState.current)
                    button.setAttribute('data-active', '');
                button.title = summary.cwd;
                const label = document.createElement('span');
                label.setAttribute('data-timestamp-temp-label', '');
                label.textContent = summary.title || summary.cwd.split(/[\\/]/).pop() || '新会话';
                button.append(label);
                button.addEventListener('click', () => sessions.open(id));
                list.appendChild(button);
            }
            section.hidden = list.childElementCount === 0;
            for (const node of region?.querySelectorAll('[class*="groupSection"]') ?? []) {
                const text = node.textContent?.trim() ?? '';
                if (text.startsWith('未分组') || text.startsWith('Ungrouped'))
                    node.style.display = 'none';
            }
        };
        const observer = new MutationObserver(render);
        observer.observe(document.body, { childList: true, subtree: true });
        const unsubSessions = sessions?.list?.subscribe?.(render) ?? (() => { });
        const unsubWorkspaces = workspaces?.list?.subscribe?.(render) ?? (() => { });
        render();
        return () => { unsubSessions(); unsubWorkspaces(); observer.disconnect(); section.remove(); style.remove(); };
    }
    function apply(ctx, config) {
        runtime = ctx;
        const fallbackRoot = config?.rootDirectory ?? '';
        const workspaces = ctx.workspaces;
        const sessions = ctx.sessions;
        if (workspaces && typeof workspaces.startSession === 'function' && originalStartSession === null) {
            originalStartSession = workspaces.startSession.bind(workspaces);
            workspaces.startSession = (workspaceId) => {
                if (workspaceId === undefined)
                    return autoCreateAndStart(workspaces, sessions, fallbackRoot);
                originalStartSession(workspaceId);
                return undefined;
            };
        }
        suppressStartupAutoSelection(ctx.workspaces);
        const pick = () => ctx.workspaces.pickDirectory();
        const create = (root, name) => ctx.workspaces.createDirectory(root, name);
        const heroOccupant = (owner) => React.createElement(HeroFlow, { owner, pick, create, root: fallbackRoot, workspaces });
        const sidebarOccupant = (owner) => React.createElement(SidebarFlow, { owner, pick, create, root: fallbackRoot, workspaces });
        const injected = () => ({});
        // The host (x6) already holds a priority-0 registration on both single
        // directory-flow holes; register at a lower priority to shadow it
        // (ascending priority, lowest renders). We contribute occupants only — the
        // child holes are declared by the host's picker entry and must not be
        // redeclared (the slot engine rejects duplicate child declarations).
        ctx.slots.inject('conversation.hero.workspace.directoryFlow', () => ctx.slots.inject('sidebar.workspaces.directoryFlow', function* () {
            yield ctx.slots.register({ name: 'conversation.hero.workspace.directoryFlow', inject: injected, priority: -1 }, heroOccupant);
            yield ctx.slots.register({ name: 'sidebar.workspaces.directoryFlow', inject: injected, priority: -1 }, sidebarOccupant);
        }));
        // Keep the host's composer.bar registration and wrap its component in place.
        // No competing composer slot entry is registered; the original DOM/props
        // contract remains intact and only temporary cwd-only sessions are unlocked.
        installNativeComposerOverride(ctx.slots, sessions, workspaces);
        const effect = ctx.effect;
        const disposeTempSection = mountTemporaryConversationSection(sessions, workspaces);
        if (typeof effect === 'function')
            effect(() => disposeTempSection, 'timestamp-workspace: temporary conversation sidebar');
        // Settings-panel section (same recipe as deepseek-harness-wallet): a row
        // in the host Settings shell that reads/writes the rootDirectory through
        // the plugin's own fenced route. Guarded so older hosts without the
        // settings section slot keep loading the plugin.
        if (ctx.slots && typeof ctx.slots.inject === 'function') {
            try {
                ;
                ctx.slots.inject('settings.section', () => ctx.slots.register({
                    name: 'settings.section',
                    id: 'timestamp-workspace',
                    order: 60,
                    label: () => '时间戳工作区',
                    inject: () => ({}),
                }, TimestampSettingsSection));
            }
            catch { /* host without the settings section slot */ }
        }
    }

    return module.exports
  }
})
