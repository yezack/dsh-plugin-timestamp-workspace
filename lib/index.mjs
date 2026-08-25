import z from "@deepseek-ai/schemastery";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";

//#region src/index.ts
const name = "timestamp-workspace";
const inject = ["webServer"];
const Config = z.object({ rootDirectory: z.string() });
const STORE_PATH = join(process.env.DSH_HOME ?? join(homedir(), ".dsh"), "storages", "timestamp-workspace.json");
function readStore() {
	try {
		const data = JSON.parse(readFileSync(STORE_PATH, "utf8"));
		if (data && typeof data.rootDirectory === "string" && data.rootDirectory.trim()) return { rootDirectory: data.rootDirectory.trim() };
	} catch {}
	return {};
}
function writeStore(rootDirectory) {
	mkdirSync(dirname(STORE_PATH), { recursive: true });
	const tmp = STORE_PATH + ".tmp";
	writeFileSync(tmp, JSON.stringify({
		version: 1,
		rootDirectory
	}, null, 2));
	renameSync(tmp, STORE_PATH);
}
function json(res, status, body) {
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-store"
	});
	res.end(JSON.stringify(body));
}
function readBody(req, cap = 64 * 1024) {
	return new Promise((resolve) => {
		let size = 0;
		const parts = [];
		let settled = false;
		const done = (value) => {
			if (!settled) {
				settled = true;
				resolve(value);
			}
		};
		req.on("data", (chunk) => {
			size += chunk.length;
			if (size <= cap) parts.push(chunk);
			else done(null);
		});
		req.on("end", () => done(Buffer.concat(parts).toString("utf8")));
		req.on("error", () => done(null));
	});
}
/** Host half: filesystem operations are provided by the official Workspace service. */
function apply(ctx, config) {
	const yamlRoot = typeof config?.rootDirectory === "string" ? config.rootDirectory.trim() : "";
	const resolveRoot = () => {
		return readStore().rootDirectory ?? yamlRoot;
	};
	ctx.effect?.(() => {
		return ctx.webServer.register({
			kind: "exact",
			path: "/api/timestamp-workspace/settings",
			handler: async (req, res) => {
				if (req.method === "GET") return json(res, 200, { rootDirectory: resolveRoot() });
				if (req.method !== "PUT") return json(res, 405, {
					ok: false,
					error: "method-not-allowed"
				});
				const body = await readBody(req);
				let payload;
				try {
					payload = JSON.parse(body ?? "{}");
				} catch {
					return json(res, 400, {
						ok: false,
						error: "bad-json"
					});
				}
				const root = payload?.rootDirectory;
				if (typeof root !== "string" || !root.trim()) return json(res, 400, {
					ok: false,
					error: "rootDirectory 不能为空"
				});
				const trimmed = root.trim();
				try {
					if (!statSync(trimmed).isDirectory()) return json(res, 400, {
						ok: false,
						error: `不是目录：${trimmed}`
					});
				} catch {
					return json(res, 400, {
						ok: false,
						error: `目录不存在或不可访问：${trimmed}`
					});
				}
				writeStore(trimmed);
				ctx.logger?.info?.(`[timestamp-workspace] rootDirectory -> ${trimmed}`);
				return json(res, 200, {
					ok: true,
					rootDirectory: trimmed
				});
			}
		});
	}, "timestamp-workspace: /api/timestamp-workspace/settings");
}

//#endregion
export { Config, apply, inject, name };