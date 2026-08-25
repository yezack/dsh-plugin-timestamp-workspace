# dsh-plugin-timestamp-workspace

A DeepSeek Harness workspace-flow plugin. Users can pick an existing directory or create a new workspace named with local time (`yyyyMMddHHmmss`) under a configured root directory.

The plugin keeps new sessions in the explicit default workspace-less state instead of inheriting the previous workspace. The blank-session picker shows the current workspace state, provides a clear button for an explicitly selected workspace, and returns to the default state after clearing. Startup also avoids restoring the previous workspace.

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

## Settings UI

The dsh Settings shell shows a "Timestamp workspace" section to pick/type and save `rootDirectory`. The value is persisted to `$DSH_HOME/storages/timestamp-workspace.json` and **takes precedence over** the `cordis.patch.yml` value; the directory-flow dialog re-fetches it on every open, so saves apply without a reload.

`rootDirectory` configures automatic timestamp-folder creation only; it is not treated as the current session workspace.
