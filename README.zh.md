# dsh-plugin-timestamp-workspace

DeepSeek Harness 工作区插件：用户可以选择已有目录，也可以不选择目录，直接在配置根目录下自动创建按本地时间命名的工作区。

## 行为

- 选择已有工作区：调用官方目录选择器。
- 自动创建：在 `rootDirectory` 下创建 `yyyyMMddHHmmss` 子目录。
- 目录创建和 Workspace 注册复用官方服务。
- 同一秒发生冲突时显示错误，不静默覆盖目录。

## 配置

在 profile 的 `cordis.yml` 中加入：

```yaml
- dsh-plugin-timestamp-workspace:
    rootDirectory: C:/Users/你的用户名/Documents/dsh-workspaces
```

路径必须是 Host 可访问的已存在目录。
## 从 GitHub 安装

```powershell
dsh plugin --profile web add github:yezack/dsh-plugin-timestamp-workspace
```

安装后，在 profile 的 patch 配置中设置 `rootDirectory`。该目录必须已经存在，并且 Host 可访问。
