import * as React from "react";

//#region src/client.ts
const name = "timestamp-workspace-client";
const inject = [
	"slots",
	"workspaces",
	"sessions"
];
function formatTimestamp(date = /* @__PURE__ */ new Date()) {
	const pad = (n) => String(n).padStart(2, "0");
	return String(date.getFullYear()) + pad(date.getMonth() + 1) + pad(date.getDate()) + pad(date.getHours()) + pad(date.getMinutes()) + pad(date.getSeconds());
}
async function createTimestampWorkspace(createDirectory, rootDirectory, date = /* @__PURE__ */ new Date()) {
	const root = rootDirectory.trim();
	if (!root) throw new Error("rootDirectory 未配置");
	return createDirectory(root, formatTimestamp(date));
}
/** The plugin's own fenced settings route (host half serves it). */
const SETTINGS_URL = "/api/timestamp-workspace/settings";
async function fetchSettings() {
	const res = await fetch(SETTINGS_URL);
	if (!res.ok) throw new Error(`settings fetch failed: ${res.status}`);
	return res.json();
}
async function updateSettings(rootDirectory) {
	const res = await fetch(SETTINGS_URL, {
		method: "PUT",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ rootDirectory })
	});
	if (!res.ok) {
		const data = await res.json().catch(() => null);
		throw new Error(data && typeof data.error === "string" && data.error || `settings update failed: ${res.status}`);
	}
}
let runtime = null;
let originalStartSession = null;
let autoCreating = false;
function withTimeout(promise, ms, label) {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(/* @__PURE__ */ new Error(`timeout after ${ms}ms: ${label}`)), ms);
		promise.then((value) => {
			clearTimeout(timer);
			resolve(value);
		}, (reason) => {
			clearTimeout(timer);
			reject(reason);
		});
	});
}
async function autoCreateAndStart(workspaces, sessions, fallbackRoot) {
	if (autoCreating || !workspaces || !sessions) return;
	autoCreating = true;
	try {
		let root = fallbackRoot;
		try {
			const settings = await fetchSettings();
			if (settings.rootDirectory) root = settings.rootDirectory;
		} catch {}
		const trimmed = root.trim();
		if (!trimmed) throw new Error("rootDirectory 未配置");
		console.log("[timestamp-workspace] new conversation: creating temp task folder under", trimmed);
		const path = await withTimeout(workspaces.createDirectory(trimmed, formatTimestamp()), 2e4, "createDirectory");
		console.log("[timestamp-workspace] temp task folder ready:", path);
		const result = await withTimeout(sessions.create({ cwd: path }), 2e4, "sessions.create");
		if (!result.ok) throw new Error(result.error?.message ?? "session create failed");
		const sessionId = result.value?.sessionId;
		if (!sessionId) throw new Error("session create returned no sessionId");
		console.log("[timestamp-workspace] temp task session ready:", sessionId);
		await withTimeout(Promise.resolve(sessions.open(sessionId)), 2e4, "sessions.open");
	} catch (reason) {
		console.warn("[timestamp-workspace] temp task start failed, staying blank:", reason);
		clearWorkspaceSelection(workspaces ?? {});
	} finally {
		autoCreating = false;
	}
}
let startupMaskInstalled = false;
function suppressStartupAutoSelection(workspaces) {
	if (startupMaskInstalled) return;
	const ws = workspaces;
	const list = ws?.list;
	const set = list?.set;
	const sessionsList = ws?.sessions?.list;
	const getSessionSnapshot = sessionsList?.getSnapshot;
	if (!list || typeof set !== "function" || !sessionsList || typeof getSessionSnapshot !== "function") return;
	startupMaskInstalled = true;
	list.set = (next) => {
		if (next.baselinesReady === true) {
			list.set = set;
			if (getSessionSnapshot()?.current === void 0 && next.recentWorkspaceId !== void 0) next = {
				...next,
				recentWorkspaceId: void 0
			};
		}
		return set(next);
	};
}
function TimestampSettingsSection(props) {
	const [root, setRoot] = React.useState("");
	const [loading, setLoading] = React.useState(true);
	const [busy, setBusy] = React.useState(false);
	const [error, setError] = React.useState(null);
	const [saved, setSaved] = React.useState(false);
	React.useEffect(() => {
		let alive = true;
		fetchSettings().then((settings) => {
			if (alive) {
				setRoot(settings.rootDirectory);
				setLoading(false);
			}
		}).catch((reason) => {
			if (!alive) return;
			setError(reason instanceof Error ? reason.message : String(reason));
			setLoading(false);
		});
		return () => {
			alive = false;
		};
	}, []);
	const persist = async (next) => {
		setBusy(true);
		setError(null);
		setSaved(false);
		try {
			await updateSettings(next);
			setRoot(next);
			setSaved(true);
		} catch (reason) {
			setError(reason instanceof Error ? reason.message : String(reason));
		} finally {
			setBusy(false);
		}
	};
	const pick = async () => {
		if (runtime === null || busy) return;
		try {
			const picked = await runtime.workspaces.pickDirectory();
			if (picked) await persist(picked);
		} catch (reason) {
			setError(reason instanceof Error ? reason.message : String(reason));
		}
	};
	const save = async () => {
		if (busy) return;
		const trimmed = root.trim();
		if (!trimmed) {
			setError("rootDirectory 不能为空");
			return;
		}
		await persist(trimmed);
	};
	return React.createElement("div", { style: {
		padding: "4px 0",
		display: "flex",
		flexDirection: "column",
		gap: 12
	} }, React.createElement("p", { style: {
		margin: 0,
		fontSize: 13,
		opacity: .8
	} }, "自动创建的时间戳工作区将生成在此根目录下（YYYYMMDDHHmmss 命名）。保存后立即生效，优先于 cordis.patch.yml 里的 rootDirectory 配置。"), loading ? React.createElement("p", { style: {
		margin: 0,
		fontSize: 13,
		opacity: .6
	} }, "读取配置中…") : React.createElement("div", { style: {
		display: "flex",
		flexDirection: "column",
		gap: 8
	} }, React.createElement("label", { style: {
		fontSize: 13,
		display: "flex",
		flexDirection: "column",
		gap: 4
	} }, "根目录（rootDirectory）", React.createElement("input", {
		value: root,
		disabled: busy,
		placeholder: "例如 C:/Users/yezac/Documents/dsh-workspaces",
		onChange: (event) => {
			setRoot(event.target.value);
			setSaved(false);
		},
		style: {
			padding: "6px 8px",
			borderRadius: 6,
			border: "1px solid rgba(128,128,128,0.35)",
			background: "transparent",
			color: "inherit",
			fontSize: 13
		}
	})), React.createElement("div", { style: {
		display: "flex",
		gap: 8
	} }, React.createElement("button", {
		disabled: busy,
		onClick: pick
	}, busy ? "处理中…" : "选择目录…"), React.createElement("button", {
		disabled: busy,
		onClick: save
	}, "保存")), error && React.createElement("div", {
		role: "alert",
		style: {
			fontSize: 13,
			color: "#e5484d"
		}
	}, error), saved && React.createElement("div", { style: {
		fontSize: 13,
		color: "#30a46c"
	} }, "已保存")), props.close && React.createElement("button", { onClick: props.close }, "完成"));
}
function clearWorkspaceSelection(workspaces) {
	try {
		workspaces.sessions?.clear?.();
	} catch {}
}
function WorkspaceState(props) {
	const { selectedId, selectedTitle, clear } = props;
	const selected = selectedId !== void 0 || selectedTitle !== void 0;
	return React.createElement("div", {
		"data-timestamp-workspace-state": selected ? "selected" : "default",
		style: {
			display: "flex",
			alignItems: "center",
			gap: 8,
			marginBottom: 8
		}
	}, React.createElement("span", {
		role: "status",
		style: {
			fontSize: 13,
			opacity: selected ? 1 : .75
		}
	}, selected ? `工作区：${selectedTitle || selectedId}` : "默认工作区"), selected && React.createElement("button", {
		type: "button",
		"aria-label": "取消当前工作区",
		title: "取消当前工作区",
		onClick: clear,
		style: {
			width: 24,
			height: 24,
			padding: 0,
			border: 0,
			borderRadius: 4,
			background: "transparent",
			color: "inherit",
			cursor: "pointer",
			fontSize: 16,
			lineHeight: "24px"
		}
	}, "×"));
}
/** Single path segment, host-style display label for a cwd. */
function workspaceLabel(path) {
	const trimmed = path.replace(/[\\/]+$/, "");
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
	const usable = typeof React.useSyncExternalStore === "function" && !!list?.getSnapshot && typeof list.subscribe === "function" && !!sessions?.getSnapshot && typeof sessions.subscribe === "function";
	const projection = usable ? React.useSyncExternalStore((listener) => list.subscribe(listener), () => list.getSnapshot()) : void 0;
	const session = usable ? React.useSyncExternalStore((listener) => sessions.subscribe(listener), () => sessions.getSnapshot()) : void 0;
	if (!projection || !session) return {};
	const currentId = session?.current;
	const current = projection?.items?.find((item) => currentId !== void 0 && item.sessionIds?.includes(currentId));
	if (current) return {
		selectedId: current.workspaceId,
		selectedTitle: current.title
	};
	const summary = currentId !== void 0 ? session?.byId?.[currentId] : void 0;
	if (summary?.cwd) return { selectedTitle: workspaceLabel(summary.cwd) };
	return {};
}
function FlowDialog(props) {
	return React.createElement("div", {
		role: "dialog",
		"aria-label": "Workspace creation",
		style: {
			padding: 16,
			minWidth: 320
		}
	}, React.createElement("strong", null, "选择工作区"), React.createElement("p", null, "可以选择已有目录；也可以自动创建按当前时间命名的新工作区。"), props.error && React.createElement("div", {
		role: "alert",
		style: { color: "#b42318" }
	}, props.error), React.createElement("button", {
		disabled: props.busy,
		onClick: props.onPick
	}, props.busy ? "处理中…" : "选择已有工作区"), React.createElement("button", {
		disabled: props.busy,
		onClick: props.onCreate
	}, "自动创建时间戳工作区"), React.createElement("button", {
		disabled: props.busy,
		onClick: props.onCancel
	}, "取消"));
}
function FlowDialogHost(props) {
	const { owner, pick, create, root } = props;
	const [busy, setBusy] = React.useState(false);
	const [error, setError] = React.useState(null);
	const [rootDir, setRootDir] = React.useState(root);
	const run = async (operation) => {
		if (busy) return;
		setBusy(true);
		setError(null);
		try {
			const path = await operation();
			path ? owner.onPicked(path) : owner.onCancel();
		} catch (reason) {
			const message = reason instanceof Error ? reason.message : String(reason);
			setError(message);
			owner.onError(message);
		} finally {
			setBusy(false);
		}
	};
	React.useEffect(() => {
		if (!owner.open) return;
		let alive = true;
		fetchSettings().then((settings) => {
			if (alive && settings.rootDirectory) setRootDir(settings.rootDirectory);
		}).catch(() => {});
		return () => {
			alive = false;
		};
	}, [owner.open]);
	return FlowDialog({
		busy,
		error,
		onPick: () => run(pick),
		onCreate: () => run(() => createTimestampWorkspace(create, rootDir)),
		onCancel: owner.onCancel
	});
}
/**
* Hero occupant: closed state shows the workspace state row + clear button
* (the host renders this outlet next to its picker menu); open state hosts
* the directory creation dialog.
*/
function HeroFlow(props) {
	const { owner, workspaces } = props;
	const selection = useCurrentWorkspace(workspaces);
	if (owner.open) return React.createElement(FlowDialogHost, {
		owner,
		pick: props.pick,
		create: props.create,
		root: props.root
	});
	return React.createElement(WorkspaceState, {
		selectedId: selection.selectedId,
		selectedTitle: selection.selectedTitle,
		clear: () => clearWorkspaceSelection(workspaces ?? {})
	});
}
/** Sidebar occupant: creation dialog only (no state row in the sidebar). */
function SidebarFlow(props) {
	if (!props.owner.open) return null;
	return React.createElement(FlowDialogHost, {
		owner: props.owner,
		pick: props.pick,
		create: props.create,
		root: props.root
	});
}
function apply(ctx, config) {
	runtime = ctx;
	const workspaces = ctx.workspaces;
	const sessions = ctx.sessions;
	if (workspaces && typeof workspaces.startSession === "function" && originalStartSession === null) {
		originalStartSession = workspaces.startSession.bind(workspaces);
		workspaces.startSession = (workspaceId) => {
			if (workspaceId === void 0) return autoCreateAndStart(workspaces, sessions, config.rootDirectory);
			originalStartSession(workspaceId);
		};
	}
	suppressStartupAutoSelection(ctx.workspaces);
	const pick = () => ctx.workspaces.pickDirectory();
	const create = (root, name) => ctx.workspaces.createDirectory(root, name);
	const heroOccupant = (owner) => React.createElement(HeroFlow, {
		owner,
		pick,
		create,
		root: config.rootDirectory,
		workspaces
	});
	const sidebarOccupant = (owner) => React.createElement(SidebarFlow, {
		owner,
		pick,
		create,
		root: config.rootDirectory
	});
	const injected = () => ({});
	ctx.slots.inject("conversation.hero.workspace.directoryFlow", () => ctx.slots.inject("sidebar.workspaces.directoryFlow", function* () {
		yield ctx.slots.register({
			name: "conversation.hero.workspace.directoryFlow",
			inject: injected,
			priority: -1
		}, heroOccupant);
		yield ctx.slots.register({
			name: "sidebar.workspaces.directoryFlow",
			inject: injected,
			priority: -1
		}, sidebarOccupant);
	}));
	if (ctx.slots && typeof ctx.slots.inject === "function") try {
		ctx.slots.inject("settings.section", () => ctx.slots.register({
			name: "settings.section",
			id: "timestamp-workspace",
			order: 60,
			label: () => "时间戳工作区",
			inject: () => ({})
		}, TimestampSettingsSection));
	} catch {}
}

//#endregion
export { apply, createTimestampWorkspace, formatTimestamp, inject, name };