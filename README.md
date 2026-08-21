# dsh-plugin-timestamp-workspace

A DeepSeek Harness workspace-flow plugin. Users can pick an existing directory or create a new workspace named with local time (`yyyyMMddHHmmss`) under a configured root directory.

The plugin composes the official workspace directory-flow slots and reuses the official workspace service.
## Install from GitHub

```powershell
dsh plugin --profile web add github:yezack/dsh-plugin-timestamp-workspace
```

After installation, configure `rootDirectory` in the profile patch layer. The directory must already exist and be accessible to the Host.
