import z from "@deepseek-ai/schemastery";

//#region src/index.d.ts
declare const name = "timestamp-workspace";
declare const inject: string[];
declare const Config: z<Schemastery.ObjectS<{
  rootDirectory: z<string, string>;
}>, Schemastery.ObjectT<{
  rootDirectory: z<string, string>;
}>>;
/** Host half: filesystem operations are provided by the official Workspace service. */
declare function apply(ctx: {
  webServer: {
    register(desc: {
      kind: string;
      path: string;
      handler(req: unknown, res: unknown): void;
    }): () => void;
  };
  logger?: {
    info(msg: string): void;
    warn(msg: string): void;
  };
}, config?: {
  rootDirectory?: string;
}): void;
//#endregion
export { Config, apply, inject, name };