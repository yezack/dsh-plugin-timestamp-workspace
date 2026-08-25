# dsh-plugin-timestamp-workspace

A DeepSeek Harness workspace-flow plugin. Users can pick an existing directory or create a new workspace named with local time (`yyyyMMddHHmmss`) under a configured root directory.

New conversations start as a temporary task without inheriting the previous folder: a parameterless New Session creates a `yyyyMMddHHmmss` folder under the configured root and opens an ungrouped (temporary) session bound to that folder as its cwd — **not registered as a workspace** — so you can type immediately without picking (the host blocks composer input while no session exists, so this keeps the "don't pick, just chat" flow usable). Choosing an existing directory or auto-creating a timestamp workspace through the directory flow registers a real workspace as usual. The blank-session picker shows the current workspace state (a temp task is labeled by its folder name) and provides a clear button; clearing (×) returns to the blank view, and startup also avoids restoring the previous workspace. When `rootDirectory` is unset or the temp task fails, the flow falls back to the blank view with a console diagnostic.

The plugin composes the official workspace directory-flow slots and reuses the official workspace service.

## Configuration

Add to the profile's `cordis.patch.yml`. The plugin **must** be registered with an `insert` entry — a bare plugin entry is rejected by the patch loader (`id is required for non-insert patches`) and the server-side routes never mount:

```yaml
- insert:
    - id: timestamp-workspace
      name: dsh-plugin-timestamp-workspace
      config:
        rootDirectory: C:/Users/<your-name>/Documents/dsh-workspaces
```

## Temporary conversations

A parameterless New Session creates a timestamp folder under `rootDirectory` and opens an ungrouped temporary session. The plugin uses the public `conversation.composer` takeover chain only for cwd-only temporary sessions, so their input is available without selecting a workspace. Registered workspace sessions keep the official InputBar unchanged. No DSH Desktop files are modified.

## Settings UI

The dsh Settings shell shows a "Timestamp workspace" section to pick/type and save `rootDirectory`. The value is persisted to `$DSH_HOME/storages/timestamp-workspace.json` and **takes precedence over** the `cordis.patch.yml` value; the directory-flow dialog re-fetches it on every open, so saves apply without a reload. Saving validates that the path exists and is a directory; invalid paths are rejected with an error instead of being persisted.

`rootDirectory` configures automatic timestamp-folder creation only; it is not treated as the current session workspace.
