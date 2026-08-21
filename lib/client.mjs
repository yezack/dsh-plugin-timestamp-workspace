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
function Flow(props) {
	const { owner, pick, create, root } = props;
	const [busy, setBusy] = React.useState(false);
	const [error, setError] = React.useState(null);
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
		onClick: () => run(() => createTimestampWorkspace(create, root))
	}, "自动创建时间戳工作区"), React.createElement("button", {
		disabled: busy,
		onClick: owner.onCancel
	}, "取消"));
}
function apply(ctx, config) {
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
}

//#endregion
export { apply, createTimestampWorkspace, formatTimestamp, inject, name };