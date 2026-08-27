import * as React from "react";
import { ClientContext } from "@deepseek-ai/dsh-client-runtime/client";

//#region src/client.d.ts
declare const name = "timestamp-workspace-client";
declare const inject: string[];
interface Config {
  rootDirectory?: string;
}
declare function formatTimestamp(date?: Date): string;
declare function createTimestampWorkspace(createDirectory: (root: string, name: string) => Promise<string>, rootDirectory: string, date?: Date): Promise<string>;
/**
 * Multi-select archive dialog: first step lists the workspace's sessions
 * (check toggles), second step is the explicit confirmation. Modal/Button are
 * the host primitives; rows use host design tokens only.
 */
declare function BatchArchiveDialog(props: {
  workspaceId: string;
  label: string;
  onClose: () => void;
}): React.DetailedReactHTMLElement<{
  style: {
    position: "fixed";
    inset: number;
    zIndex: number;
    background: string;
    display: "flex";
    alignItems: "center";
    justifyContent: "center";
  };
}, HTMLElement> | React.CElement<{
  open: boolean;
  onClose: () => void;
  closeLabel: string;
  title: string;
  footer: React.FunctionComponentElement<{
    children?: React.ReactNode | undefined;
  }>;
}, React.Component<{
  open: boolean;
  onClose: () => void;
  closeLabel: string;
  title: string;
  footer: React.FunctionComponentElement<{
    children?: React.ReactNode | undefined;
  }>;
}, any, any>>;
declare function apply(ctx: ClientContext, config?: Config): void;
//#endregion
export { BatchArchiveDialog, Config, apply, createTimestampWorkspace, formatTimestamp, inject, name };