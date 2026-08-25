# dsh-plugin-timestamp-workspace

A DeepSeek Harness workspace-flow plugin. Users can pick an existing directory or create a new workspace named with local time (`yyyyMMddHHmmss`) under a configured root directory.

**New Session keeps the official flow**: the plugin does not hijack it — clicking New Session still opens the host's "choose a workspace" flow. Next to the official picker chip (the hero's "choose a workspace" row) the plugin adds an **"开启临时会话" (Start temporary session)** button: clicking it creates a `yyyyMMddHHmmss` folder under the configured root and opens an ungrouped (temporary) session bound to that folder as its cwd — **not registered as a workspace** — so you can type immediately without picking. "Add workspace" keeps the host-native picking flow (in-app browse / native chooser); the plugin no longer occupies the directory-flow slots. Temporary sessions appear in the sidebar's ungrouped group, pinned to the top with a "未分组 (N)" count and a dashed outline; their blank placeholder rows read "新的临时会话". Unused blank temporary folders are auto-cleaned before a new temporary session starts and when a blank temporary session is archived. Startup restores the official default (auto-restore the last workspace).

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

Clicking the hero's "开启临时会话" button creates a timestamp folder under `rootDirectory` and opens an ungrouped temporary session. The plugin uses the public `conversation.composer` takeover chain only for cwd-only temporary sessions, so their input is available without selecting a workspace. Registered workspace sessions keep the official InputBar unchanged. No DSH Desktop files are modified.

## Settings UI

The dsh Settings shell shows a "Timestamp workspace" section to pick/type and save `rootDirectory`. The value is persisted to `$DSH_HOME/storages/timestamp-workspace.json` and **takes precedence over** the `cordis.patch.yml` value; the hero button re-fetches it on every click, so saves apply without a reload. Saving validates that the path exists and is a directory; invalid paths are rejected with an error instead of being persisted.

`rootDirectory` configures automatic timestamp-folder creation only; it is not treated as the current session workspace.
