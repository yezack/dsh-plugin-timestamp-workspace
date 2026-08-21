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
    function Flow(props) {
        const { owner, pick, create, root } = props;
        const [busy, setBusy] = React.useState(false);
        const [error, setError] = React.useState(null);
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
        if (!owner.open)
            return null;
        return React.createElement('div', { role: 'dialog', 'aria-label': 'Workspace creation', style: { padding: 16, minWidth: 320 } }, React.createElement('strong', null, '选择工作区'), React.createElement('p', null, '可以选择已有目录；也可以自动创建按当前时间命名的新工作区。'), error && React.createElement('div', { role: 'alert', style: { color: '#b42318' } }, error), React.createElement('button', { disabled: busy, onClick: () => run(pick) }, busy ? '处理中…' : '选择已有工作区'), React.createElement('button', { disabled: busy, onClick: () => run(() => createTimestampWorkspace(create, root)) }, '自动创建时间戳工作区'), React.createElement('button', { disabled: busy, onClick: owner.onCancel }, '取消'));
    }
    function apply(ctx, config) {
        const occupant = (owner) => React.createElement(Flow, { owner, pick: () => ctx.workspaces.pickDirectory(), create: (root, name) => ctx.workspaces.createDirectory(root, name), root: config.rootDirectory });
        const injected = () => ({});
        // The host (x6) already holds a priority-0 registration on both single
        // directory-flow holes; register at a lower priority to shadow it
        // (ascending priority, lowest renders).
        ctx.slots.inject('conversation.hero.workspace.directoryFlow', () => ctx.slots.inject('sidebar.workspaces.directoryFlow', function* () {
            yield ctx.slots.register({ name: 'conversation.hero.workspace.directoryFlow', inject: injected, priority: -1 }, occupant);
            yield ctx.slots.register({ name: 'sidebar.workspaces.directoryFlow', inject: injected, priority: -1 }, occupant);
        }));
    }

    return module.exports
  }
})
