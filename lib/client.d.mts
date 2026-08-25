import { ClientContext } from "@deepseek-ai/dsh-client-runtime/client";

//#region src/client.d.ts
declare const name = "timestamp-workspace-client";
declare const inject: string[];
interface Config {
  rootDirectory?: string;
}
declare function formatTimestamp(date?: Date): string;
declare function createTimestampWorkspace(createDirectory: (root: string, name: string) => Promise<string>, rootDirectory: string, date?: Date): Promise<string>;
declare function apply(ctx: ClientContext, config?: Config): void;
//#endregion
export { Config, apply, createTimestampWorkspace, formatTimestamp, inject, name };