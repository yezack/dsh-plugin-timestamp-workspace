# dsh-plugin-timestamp-workspace

DeepSeek Harness 工作区插件：用户可以选择已有目录，也可以不选择目录，直接在配置根目录下自动创建按本地时间命名的工作区。

## 行为

- 选择已有工作区：调用官方目录选择器。
- 自动创建：在 `rootDirectory` 下创建 `yyyyMMddHHmmss` 子目录。
- 目录创建和 Workspace 注册复用官方服务。
- 同一秒发生冲突时显示错误，不静默覆盖目录。

## 配置

在 profile 的 `cordis.patch.yml` 中加入（必须用 `insert` 形式注册，bare 插件条目会被 patch loader 以 `id is required for non-insert patches` 拒绝，导致服务端路由不生效）：

```yaml
- insert:
    - id: timestamp-workspace
      name: dsh-plugin-timestamp-workspace
      config:
        rootDirectory: C:/Users/你的用户名/Documents/dsh-workspaces
```

路径必须是 Host 可访问的已存在目录。

## 设置 UI

dsh 设置面板中有「时间戳工作区」分区：可选择或输入并保存 `rootDirectory`。设置值持久化到 `$DSH_HOME/storages/timestamp-workspace.json`，**优先于** `cordis.patch.yml` 里的配置；目录流对话框每次打开时会重新拉取最新配置，保存后无需重载即可生效。
