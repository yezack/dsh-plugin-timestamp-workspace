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
    exports.inject = ['slots', 'workspaces'];
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
    // object: a parameterless New Session now clears into the workspace-less
    // New Session view (the user picks a folder when they actually want one).
    // Explicit workspace targets (per-workspace New Session in the sidebar)
    // still run the original host logic. Guarded by a module-level flag so a
    // hot reload (apply re-run) does not double-wrap.
    let originalStartSession = null;
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
    function WorkspaceState(props) {
        const { selectedId, selectedTitle, clear } = props;
        const selected = selectedId !== undefined;
        return React.createElement('div', {
            'data-timestamp-workspace-state': selected ? 'selected' : 'default',
            style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 },
        }, React.createElement('span', { role: 'status', style: { fontSize: 13, opacity: selected ? 1 : 0.75 } }, selected ? `工作区：${selectedTitle || selectedId}` : '默认工作区'), selected && React.createElement('button', {
            type: 'button',
            'aria-label': '取消当前工作区',
            title: '取消当前工作区',
            onClick: clear,
            style: {
                width: 24,
                height: 24,
                padding: 0,
                border: 0,
                borderRadius: 4,
                background: 'transparent',
                color: 'inherit',
                cursor: 'pointer',
                fontSize: 16,
                lineHeight: '24px',
            },
        }, '×'));
    }
    function WorkspacePicker(props) {
        const { open, useWorkspaces, selectedId, onPick, onClose, createWorkspace, useDirectoryFlow, renderSlot, t, clear, } = props;
        const snapshot = useWorkspaces((state) => state);
        const flowAvailable = useDirectoryFlow((occupied) => occupied);
        const [flowOpen, setFlowOpen] = React.useState(false);
        const workspaces = snapshot.items;
        const openFlow = () => {
            onClose();
            if (flowAvailable)
                setFlowOpen(true);
        };
        const closeFlow = () => setFlowOpen(false);
        const flowOwner = {
            open: flowOpen,
            busy: false,
            onPicked: (path) => {
                createWorkspace({ path })
                    .then((workspace) => { setFlowOpen(false); onPick(workspace.workspaceId); })
                    .catch(() => setFlowOpen(false));
            },
            onCancel: closeFlow,
            onError: closeFlow,
        };
        const selectedTitle = workspaces.find((workspace) => workspace.workspaceId === selectedId)?.title;
        return React.createElement(React.Fragment, null, React.createElement(WorkspaceState, { selectedId, selectedTitle, clear }), open && React.createElement('div', {
            role: 'dialog',
            'aria-label': '选择工作区',
            style: { padding: 8, minWidth: 280, display: 'flex', flexDirection: 'column', gap: 6 },
        }, React.createElement('strong', null, '选择工作区'), snapshot.phase === 'pending' && React.createElement('span', { role: 'status' }, '读取工作区中…'), workspaces.map((workspace) => React.createElement('button', {
            key: workspace.workspaceId,
            type: 'button',
            disabled: selectedId === workspace.workspaceId,
            onClick: () => onPick(workspace.workspaceId),
        }, workspace.title)), flowAvailable && React.createElement('button', { type: 'button', onClick: openFlow }, t('menu.addWorkspace')), React.createElement('button', { type: 'button', onClick: onClose }, '取消')), React.createElement(React.Fragment, null, renderSlot('conversation.hero.workspace.directoryFlow', flowOwner)));
    }
    function Flow(props) {
        const { owner, pick, create, root } = props;
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
        if (!owner.open)
            return null;
        return React.createElement('div', { role: 'dialog', 'aria-label': 'Workspace creation', style: { padding: 16, minWidth: 320 } }, React.createElement('strong', null, '选择工作区'), React.createElement('p', null, '可以选择已有目录；也可以自动创建按当前时间命名的新工作区。'), error && React.createElement('div', { role: 'alert', style: { color: '#b42318' } }, error), React.createElement('button', { disabled: busy, onClick: () => run(pick) }, busy ? '处理中…' : '选择已有工作区'), React.createElement('button', { disabled: busy, onClick: () => run(() => createTimestampWorkspace(create, rootDir)) }, '自动创建时间戳工作区'), React.createElement('button', { disabled: busy, onClick: owner.onCancel }, '取消'));
    }
    function apply(ctx, config) {
        runtime = ctx;
        const workspaces = ctx.workspaces;
        if (workspaces && typeof workspaces.startSession === 'function' && originalStartSession === null) {
            originalStartSession = workspaces.startSession.bind(workspaces);
            workspaces.startSession = (workspaceId) => {
                if (workspaceId === undefined) {
                    clearWorkspaceSelection(workspaces);
                    return;
                }
                originalStartSession(workspaceId);
            };
        }
        suppressStartupAutoSelection(ctx.workspaces);
        const occupant = (owner) => React.createElement(Flow, { owner, pick: () => ctx.workspaces.pickDirectory(), create: (root, name) => ctx.workspaces.createDirectory(root, name), root: config.rootDirectory });
        const injected = () => ({});
        // The host (x6) already holds a priority-0 registration on both single
        // directory-flow holes; register at a lower priority to shadow it
        // (ascending priority, lowest renders).
        ctx.slots.inject('conversation.hero.workspace.directoryFlow', () => ctx.slots.inject('sidebar.workspaces.directoryFlow', function* () {
            yield ctx.slots.register({ name: 'conversation.hero.workspace.directoryFlow', inject: injected, priority: -1 }, occupant);
            yield ctx.slots.register({ name: 'sidebar.workspaces.directoryFlow', inject: injected, priority: -1 }, occupant);
        }));
        // Keep the host picker contract while adding an explicit workspace state row
        // and a clear button. The host registration is priority 0, so this complete
        // root-scope replacement shadows it at -1 while still declaring its child
        // directory-flow hole.
        const slots = ctx.slots;
        const pickerFlowSource = {
            getSnapshot: () => slots.entries('conversation.hero.workspace.directoryFlow').length > 0,
            subscribe: (listener) => slots.subscribe('conversation.hero.workspace.directoryFlow', listener),
        };
        const pickerInjected = () => ({
            createWorkspace: (input) => ctx.workspaces.create(input),
            hooks: { directoryFlow: pickerFlowSource },
        });
        slots.inject('conversation.hero.workspace', () => slots.register({
            name: 'conversation.hero.workspace',
            children: {
                'conversation.hero.workspace.directoryFlow': { kind: 'single', scope: 'root' },
            },
            inject: pickerInjected,
            locale: 'workspace',
            priority: -1,
        }, (props) => React.createElement(WorkspacePicker, {
            ...props,
            clear: () => {
                clearWorkspaceSelection(workspaces ?? {});
                props.onClose();
            },
        })));
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
