import z from "@deepseek-ai/schemastery";

//#region src/index.ts
const name = "timestamp-workspace";
const inject = [];
const Config = z.object({ rootDirectory: z.string().required() });
/** Host half: filesystem operations are provided by the official Workspace service. */
function apply() {}

//#endregion
export { Config, apply, inject, name };