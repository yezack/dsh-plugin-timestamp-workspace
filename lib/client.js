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
        // Same-second conflicts (the current temp task may already own this second):
        // retry the next seconds before giving up.
        let attempt = date;
        let lastError;
        for (let i = 0; i < 3; i++) {
            try {
                return await createDirectory(root, formatTimestamp(attempt));
            }
            catch (reason) {
                lastError = reason;
                attempt = new Date(attempt.getTime() + 1000);
            }
        }
        throw lastError instanceof Error ? lastError : new Error('目录创建失败（时间戳多次冲突）');
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
    // rootDirectory fallback from the patch-insert config (yaml). The live value
    // always comes from the settings route; this only backs a route failure.
    let fallbackRoot = '';
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
    async function resolveRoot() {
        try {
            const settings = await withTimeout(fetchSettings(), 1500, 'settings fetch');
            if (settings.rootDirectory)
                return settings.rootDirectory;
        }
        catch { /* keep the yaml/config fallback */ }
        return fallbackRoot;
    }
    async function autoCreateAndStart(workspaces, sessions) {
        if (!workspaces || !sessions)
            return;
        setTaskStatus({ phase: 'busy' });
        try {
            const root = await resolveRoot();
            const trimmed = root.trim();
            if (!trimmed)
                throw new Error('rootDirectory 未配置');
            // Auto-clean unused temporary tasks (blank, non-current) before creating a
            // new one, so repeated starts never accumulate folders.
            try {
                await cleanupUnusedTemporaryTasks(workspaces, sessions, trimmed);
            }
            catch { /* cleanup is best-effort */ }
            console.log('[timestamp-workspace] creating temp task folder under', trimmed);
            const path = await withTimeout(workspaces.createDirectory(trimmed, formatTimestamp()), 20000, 'createDirectory');
            console.log('[timestamp-workspace] temp task folder ready:', path);
            const sessionId = await withTimeout(sessions.create({ cwd: path }), 20000, 'sessions.create');
            console.log('[timestamp-workspace] temp task session ready:', sessionId);
            await withTimeout(Promise.resolve(sessions.open(sessionId)), 20000, 'sessions.open');
            setTaskStatus({ phase: 'idle' });
        }
        catch (reason) {
            // Temp-task setup failed (no root configured, same-second conflict,
            // host rejection, timeout...): keep the current view and surface the
            // reason next to the hero button (visible without DevTools).
            const message = reason instanceof Error ? reason.message : String(reason);
            console.warn('[timestamp-workspace] temp task start failed:', reason);
            setTaskStatus({ phase: 'error', message });
        }
    }
    /** The hero button action: a temporary task needs no workspace pick. */
    function startTemporaryTask() {
        if (runtime === null)
            return;
        void autoCreateAndStart(runtime.workspaces, runtime.sessions);
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
        return React.createElement('div', { style: { padding: '4px 0', display: 'flex', flexDirection: 'column', gap: 12 } }, React.createElement('p', { style: { margin: 0, fontSize: 13, opacity: 0.8 } }, '开启临时会话时，将在此根目录下自动创建 YYYYMMDDHHmmss 命名的工作区文件夹。保存后立即生效，优先于 cordis.patch.yml 里的 rootDirectory 配置。'), loading
            ? React.createElement('p', { style: { margin: 0, fontSize: 13, opacity: 0.6 } }, '读取配置中…')
            : React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } }, React.createElement('label', { style: { fontSize: 13, display: 'flex', flexDirection: 'column', gap: 4 } }, '根目录（rootDirectory）', React.createElement('input', {
                value: root,
                disabled: busy,
                placeholder: '例如 C:/Users/yezac/Documents/dsh-workspaces',
                onChange: (event) => { setRoot(event.target.value); setSaved(false); },
                style: { padding: '6px 8px', borderRadius: 6, border: '1px solid rgba(128,128,128,0.35)', background: 'transparent', color: 'inherit', fontSize: 13 },
            })), React.createElement('div', { style: { display: 'flex', gap: 8 } }, React.createElement('button', { disabled: busy, onClick: pick }, busy ? '处理中…' : '选择目录…'), React.createElement('button', { disabled: busy, onClick: save }, '保存')), error && React.createElement('div', { role: 'alert', style: { fontSize: 13, color: '#e5484d' } }, error), saved && React.createElement('div', { style: { fontSize: 13, color: '#30a46c' } }, '已保存')), props.close && React.createElement('button', { onClick: props.close }, '完成'));
    }
    async function requestCleanup(paths) {
        try {
            const res = await fetch('/api/timestamp-workspace/cleanup', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ paths }),
            });
            const data = await res.json().catch(() => null);
            if (res.ok && data?.ok === true)
                return true;
            throw new Error((data && typeof data.error === 'string' ? data.error : 'cleanup failed'));
        }
        catch (reason) {
            console.warn('[timestamp-workspace] cleanup failed:', reason);
            return false;
        }
    }
    /** Archived blank temporary sessions (closed without content) drop their folders. */
    let cleanupHandledArchives = new Set();
    function installCleanupOnArchive(workspaces, sessions) {
        const sessionsList = sessions?.list;
        const workspacesList = workspaces?.list;
        if (!sessionsList?.subscribe || !workspacesList?.subscribe)
            return;
        const scan = () => {
            const sessionState = sessionsList.getSnapshot?.();
            const workspaceState = workspacesList.getSnapshot?.();
            const archived = new Set((workspaceState?.archivedSessionIds ?? []));
            const paths = [];
            for (const id of archived) {
                if (cleanupHandledArchives.has(id))
                    continue;
                const summary = sessionState?.byId?.[id];
                if (!summary?.cwd || summary.blank !== true || summary.origin === 'subagent')
                    continue;
                cleanupHandledArchives.add(id);
                paths.push(summary.cwd);
            }
            if (paths.length > 0)
                void requestCleanup(paths);
        };
        sessionsList.subscribe(scan);
        workspacesList.subscribe(scan);
    }
    /**
     * Collect and clean unused temporary tasks: blank, non-current sessions whose
     * cwd lives directly under rootDirectory. The host half deletes the folders;
     * the sessions are archived so they leave the ungrouped list.
     */
    async function cleanupUnusedTemporaryTasks(workspaces, sessions, rootOverride) {
        const sessionState = sessions?.list?.getSnapshot?.();
        const workspaceState = workspaces?.list?.getSnapshot?.();
        if (!sessionState || !workspaceState)
            return 0;
        let root = rootOverride ?? '';
        if (root === '') {
            try {
                const settings = await withTimeout(fetchSettings(), 1500, 'settings fetch');
                root = settings.rootDirectory.trim();
            }
            catch { /* keep '' -> nothing matches */ }
        }
        if (root === '')
            return 0;
        // Normalize both sides (forward slashes, lowercase) so the Windows cwd
        // (backslash) always matches the configured root (forward slash).
        const norm = (p) => p.split(String.fromCharCode(92)).join('/').replace(/\/+$/, '').toLowerCase();
        const rootKey = norm(root);
        const registered = new Set((workspaceState.items ?? []).flatMap((w) => w.sessionIds ?? []));
        const archived = new Set(workspaceState.archivedSessionIds ?? []);
        const targets = [];
        for (const id of sessionState.ids ?? []) {
            const summary = sessionState.byId?.[id];
            if (!summary?.cwd || !norm(summary.cwd).startsWith(rootKey + '/'))
                continue;
            if (registered.has(id) || archived.has(id) || id === sessionState.current)
                continue;
            if (summary.origin === 'subagent')
                continue;
            if (summary.blank !== true)
                continue;
            targets.push({ sessionId: id, cwd: summary.cwd });
        }
        if (targets.length === 0)
            return 0;
        const ok = await requestCleanup(targets.map((target) => target.cwd));
        if (!ok)
            return 0;
        const removedPaths = targets.map((target) => target.cwd);
        for (const target of targets) {
            try {
                await workspaces?.archiveSession?.(target.sessionId);
            }
            catch { /* archive is best-effort */ }
        }
        return removedPaths.length;
    }
    /**
     * Keep the host InputBar entry, including its children declaration and inject
     * contract, and wrap only its component at runtime. This preserves the exact
     * native DOM, styles, attachments, model controls, keyboard handling, draft
     * machine, and submit behavior without registering a competing slot entry.
     */
    function isTemporarySessionProps(props, sessions, workspaces) {
        const sessionId = props.sessionId;
        const sessionState = props.useSessions?.((state) => state) ?? sessions?.list?.getSnapshot?.();
        const workspaceState = props.useWorkspaces?.((state) => state) ?? workspaces?.list?.getSnapshot?.();
        const summary = sessionId === undefined ? undefined : sessionState?.byId?.[sessionId];
        const registered = sessionId !== undefined && (workspaceState?.items ?? []).some((item) => item.sessionIds?.includes(sessionId));
        return !!summary?.cwd && !registered;
    }
    let nativeComposerEntry = null;
    let nativeComposerOriginal = null;
    function installNativeComposerOverride(slots, sessions, workspaces) {
        const entries = slots?.entries?.('conversation.composer.bar') ?? [];
        const entry = entries.find((candidate) => typeof candidate.component === 'function' && candidate !== nativeComposerEntry);
        if (!entry || nativeComposerEntry === entry)
            return;
        nativeComposerEntry = entry;
        nativeComposerOriginal = entry.component;
        entry.component = (props) => {
            const temporary = isTemporarySessionProps(props, sessions, workspaces);
            const placeholder = props.placeholder === '选择一个工作区开始' || props.placeholder === 'Choose a workspace to start'
                ? '选择一个工作区或以临时会话开始'
                : props.placeholder;
            return React.createElement(nativeComposerOriginal, {
                ...props,
                disabled: temporary ? false : props.disabled,
                placeholder,
            });
        };
    }
    /**
     * The hero's "choose a workspace" row (host ConversationRoot) renders the
     * conversation.hero.workspace slot next to the WorkspaceChip. We keep the host
     * entry (its root slot is owned and its directory-flow child is host-declared,
     * so a root replacement is impossible by design) and wrap only its component:
     * a "开启临时会话" button renders alongside the chip and starts a temporary
     * task directly, while the host picker keeps its native menu/add flow.
     */
    let nativeWorkspacePickerEntry = null;
    let nativeWorkspacePickerOriginal = null;
    function HeroTempButton(props) {
        const busy = props.status.phase === 'busy';
        return React.createElement('div', { style: { display: 'inline-flex', alignItems: 'center', minWidth: 0 } }, React.createElement('button', {
            type: 'button',
            className: 'dsh-timestamp-hero-temp-button',
            title: '创建一个以当前时间命名目录的临时会话，无需选择工作区',
            disabled: busy,
            onClick: props.onStart,
        }, busy ? '创建中…' : '开启临时会话'), props.status.phase === 'error' && props.status.message
            ? React.createElement('span', { role: 'alert', className: 'dsh-timestamp-hero-temp-error' }, props.status.message)
            : null);
    }
    function WorkspacePickerWrapper(props) {
        const status = useTaskStatus();
        return React.createElement(React.Fragment, null, React.createElement(HeroTempButton, { status, onStart: startTemporaryTask }), nativeWorkspacePickerOriginal === null ? null : React.createElement(nativeWorkspacePickerOriginal, props));
    }
    function installWorkspacePickerOverride(slots) {
        const entries = slots?.entries?.('conversation.hero.workspace') ?? [];
        const entry = entries.find((candidate) => typeof candidate.component === 'function' && candidate !== nativeWorkspacePickerEntry);
        if (!entry || nativeWorkspacePickerEntry === entry)
            return;
        nativeWorkspacePickerEntry = entry;
        nativeWorkspacePickerOriginal = entry.component;
        entry.component = (props) => React.createElement(WorkspacePickerWrapper, props);
    }
    /**
     * Wrap the native WorkspaceBrowser and, after every committed render, detect
     * the ungrouped group by stable DOM signals (draggable="false" project row, no
     * workspace-actions button), pin it to the top of the tree, mark it, and give
     * its title the temporary badge. All inside our own subtree — no observers.
     */
    function WorkspaceBrowserOrderWrapper(props) {
        const containerRef = React.useRef(null);
        const useLayout = React.useLayoutEffect ?? React.useEffect;
        // Ungrouped session count per the official sessionVisible rule (tree.ts):
        // non-subagent, not archived, cwd-only, and blank only when it is current.
        const sessionState = props.useSessions?.((s) => s);
        const workspaceState = props.useWorkspaces?.((s) => s);
        let ungroupedCount = 0;
        if (sessionState !== undefined && workspaceState !== undefined) {
            const registered = new Set((workspaceState.items ?? []).flatMap((w) => w.sessionIds ?? []));
            const archived = new Set(workspaceState.archivedSessionIds ?? []);
            ungroupedCount = (sessionState.ids ?? []).filter((id) => {
                const summary = sessionState.byId?.[id];
                if (summary?.cwd === undefined || registered.has(id) || archived.has(id))
                    return false;
                if (summary.origin === 'subagent')
                    return false;
                if (summary.blank === true && id !== sessionState.current)
                    return false;
                return true;
            }).length;
        }
        useLayout(() => {
            const container = containerRef.current;
            if (container === null)
                return;
            const tree = container.querySelector('[role="tree"]');
            if (tree === null)
                return;
            for (const group of Array.from(tree.children)) {
                // The ungrouped project row is the group's first treeitem. Source
                // guarantees (tree.ts / Rows.tsx): draggable = drag !== undefined,
                // actions exist only for real workspaces, and its title text is the
                // localized 未分组/Ungrouped label. Multi-signal OR for robustness.
                const row = group.querySelector('[role="treeitem"]');
                if (row === null)
                    continue;
                const text = row.textContent ?? '';
                const isUngrouped = row.getAttribute('draggable') === 'false'
                    || row.querySelector('[aria-label*="的操作"]') === null
                    || (text.includes('未分组') && !text.includes('工作区“'));
                if (!isUngrouped)
                    continue;
                group.setAttribute('data-timestamp-ungrouped', '');
                const title = Array.from(row.querySelectorAll('span')).find((s) => {
                    const value = (s.textContent ?? '').trim();
                    return value === '未分组' || value === 'Ungrouped' || /^(未分组|Ungrouped)\s*\(\d+\)$/.test(value);
                });
                if (title !== undefined && ungroupedCount > 0) {
                    const base = (title.textContent ?? '').replace(/\s*\(\d+\)\s*$/, '');
                    const next = `${base} (${ungroupedCount})`;
                    if (title.textContent !== next)
                        title.textContent = next;
                }
                // Blank placeholder rows in the ungrouped bucket are the temporary
                // tasks started from the hero button; label them for clarity.
                for (const rowEl of Array.from(group.querySelectorAll('[role="treeitem"]'))) {
                    const title = Array.from(rowEl.querySelectorAll('span')).find((s) => (s.textContent ?? '').trim() === '新会话');
                    if (title !== undefined && title !== null)
                        title.textContent = '新的临时会话';
                }
                if (tree.firstElementChild !== group)
                    tree.insertBefore(group, tree.firstElementChild);
            }
        });
        return React.createElement('div', { ref: containerRef, style: { display: 'contents' } }, React.createElement(nativeWorkspaceBrowserOriginal, props));
    }
    let nativeWorkspaceBrowserEntry = null;
    let nativeWorkspaceBrowserOriginal = null;
    const UNGROUPED_STYLE_ID = 'dsh-timestamp-workspace-ungrouped-style';
    function installUngroupedStyle() {
        if (typeof document === 'undefined' || document.getElementById(UNGROUPED_STYLE_ID) !== null)
            return;
        const style = document.createElement('style');
        style.id = UNGROUPED_STYLE_ID;
        style.textContent = [
            '[data-timestamp-ungrouped]{font-style:italic;border:1px dashed var(--dsw-alias-border-l3);border-radius:12px;margin:0;padding:2px}',
            '.dsh-timestamp-hero-temp-button{display:inline-flex;align-items:center;gap:4px;min-height:28px;margin-left:8px;padding:0 12px;border:1px solid var(--dsw-alias-border-l3);border-radius:16px;background:transparent;color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px;font-weight:500;cursor:pointer;white-space:nowrap}',
            '.dsh-timestamp-hero-temp-button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}',
            '.dsh-timestamp-hero-temp-button:disabled{opacity:.6;cursor:default}',
            '.dsh-timestamp-hero-temp-error{font-size:12px;line-height:16px;color:var(--dsw-alias-state-error-primary);margin-left:8px}',
        ].join('\n');
        document.head.appendChild(style);
    }
    function installWorkspaceBrowserOverride(slots) {
        const entries = slots?.entries?.('sidebar.workspaces') ?? [];
        const entry = entries.find((candidate) => typeof candidate.component === 'function' && candidate !== nativeWorkspaceBrowserEntry);
        if (!entry || nativeWorkspaceBrowserEntry === entry)
            return;
        nativeWorkspaceBrowserEntry = entry;
        nativeWorkspaceBrowserOriginal = entry.component;
        installUngroupedStyle();
        entry.component = (props) => React.createElement(WorkspaceBrowserOrderWrapper, props);
    }
    function apply(ctx, config) {
        runtime = ctx;
        fallbackRoot = config?.rootDirectory ?? '';
        const workspaces = ctx.workspaces;
        const sessions = ctx.sessions;
        // New Session stays the host's original flow (choose a workspace). The
        // plugin only adds the hero "开启临时会话" button next to the picker chip.
        installWorkspacePickerOverride(ctx.slots);
        // Temporary (cwd-only, ungrouped) sessions have no workspace chip, so the
        // host would lock their composer; unlock exactly those sessions in place.
        installNativeComposerOverride(ctx.slots, sessions, workspaces);
        installWorkspaceBrowserOverride(ctx.slots);
        installCleanupOnArchive(workspaces, sessions);
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
