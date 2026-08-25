# dsh-plugin-timestamp-workspace

DeepSeek Harness 工作区插件：用户可以选择已有目录，也可以不选择目录，直接在配置根目录下自动创建按本地时间命名的工作区。

## 行为

- 新建会话默认不继承上次工作区，也不强制选择：直接开始一个「临时任务」会话——在 `rootDirectory` 下创建 `yyyyMMddHHmmss` 文件夹并以其为工作目录（cwd）打开会话，**不注册为工作区**（归入侧边栏未分组/临时区），可直接输入对话；通过目录流选择已有目录或「自动创建时间戳工作区」时才注册为正式工作区。
- 空白会话明确显示当前工作区状态；选择工作区后显示工作区名称，并提供 `X` 清除按钮。
- 点击 `X` 会清除当前会话工作区，回到空白视图（临时任务会话以文件夹名显示标签）；若 `rootDirectory` 未配置或临时任务创建失败，也会回到空白视图并输出控制台提示。
- 选择已有工作区：调用官方目录选择器。
- 自动创建：在 `rootDirectory` 下创建 `yyyyMMddHHmmss` 子目录。
- 目录创建和 Workspace 注册复用官方服务。
- 同一秒发生冲突时显示错误，不静默覆盖目录。
- 应用启动时不自动恢复上一次工作区。

## 配置

在 profile 的 `cordis.patch.yml` 中加入（必须用 `insert` 形式注册，bare 插件条目会被 patch loader 以 `id is required for non-insert patches` 拒绝，导致服务端路由不生效）：

```yaml
- insert:
    - id: timestamp-workspace
      name: dsh-plugin-timestamp-workspace
      config:
        rootDirectory: C:/Users/你的用户名/Documents/dsh-workspaces
```

路径必须是 Host 可访问的已存在目录。`rootDirectory` 只用于自动创建时间戳工作区，不会被当作当前会话已选择的工作区。

## 临时对话（纯插件）

插件通过公开的 `conversation.composer` takeover chain，仅接管“有 cwd、没有 workspaceId”的临时会话输入框；正式工作区继续使用 dsh 原生输入框，不修改 DSH Desktop 文件。新建会话会在 `rootDirectory/yyyyMMddHHmmss` 创建目录，进入未分组临时会话后即可直接输入。

## 设置 UI

dsh 设置面板中有「时间戳工作区」分区：可选择或输入并保存 `rootDirectory`。设置值持久化到 `$DSH_HOME/storages/timestamp-workspace.json`，**优先于** `cordis.patch.yml` 里的配置；目录流对话框每次打开时会重新拉取最新配置，保存后无需重载即可生效。保存时会校验目录存在且为文件夹，不合法路径会被拒绝并提示错误，不会写入配置。
