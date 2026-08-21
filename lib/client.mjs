import * as React from "react";

//#region src/client.ts
const name = "timestamp-workspace-client";
const inject = ["slots", "workspaces"];
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
function Flow(props) {
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
	if (!owner.open) return null;
	return React.createElement("div", {
		role: "dialog",
		"aria-label": "Workspace creation",
		style: {
			padding: 16,
			minWidth: 320
		}
	}, React.createElement("strong", null, "选择工作区"), React.createElement("p", null, "可以选择已有目录；也可以自动创建按当前时间命名的新工作区。"), error && React.createElement("div", {
		role: "alert",
		style: { color: "#b42318" }
	}, error), React.createElement("button", {
		disabled: busy,
		onClick: () => run(pick)
	}, busy ? "处理中…" : "选择已有工作区"), React.createElement("button", {
		disabled: busy,
		onClick: () => run(() => createTimestampWorkspace(create, rootDir))
	}, "自动创建时间戳工作区"), React.createElement("button", {
		disabled: busy,
		onClick: owner.onCancel
	}, "取消"));
}
function apply(ctx, config) {
	runtime = ctx;
	const workspaces = ctx.workspaces;
	if (workspaces && typeof workspaces.startSession === "function" && originalStartSession === null) {
		originalStartSession = workspaces.startSession.bind(workspaces);
		workspaces.startSession = (workspaceId) => {
			if (workspaceId === void 0) {
				try {
					workspaces.sessions?.clear?.();
				} catch {}
				return;
			}
			originalStartSession(workspaceId);
		};
	}
	const occupant = (owner) => React.createElement(Flow, {
		owner,
		pick: () => ctx.workspaces.pickDirectory(),
		create: (root, name) => ctx.workspaces.createDirectory(root, name),
		root: config.rootDirectory
	});
	const injected = () => ({});
	ctx.slots.inject("conversation.hero.workspace.directoryFlow", () => ctx.slots.inject("sidebar.workspaces.directoryFlow", function* () {
		yield ctx.slots.register({
			name: "conversation.hero.workspace.directoryFlow",
			inject: injected,
			priority: -1
		}, occupant);
		yield ctx.slots.register({
			name: "sidebar.workspaces.directoryFlow",
			inject: injected,
			priority: -1
		}, occupant);
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