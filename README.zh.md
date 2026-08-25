# dsh-plugin-timestamp-workspace

DeepSeek Harness 工作区插件：用户可以选择已有目录，也可以不选择目录，直接在配置根目录下自动创建按本地时间命名的工作区。

## 行为

- 新建会话自动创建时间戳工作区：不继承上一次会话，也不需要手动选择；在 `rootDirectory` 下自动生成 `yyyyMMddHHmmss` 文件夹并进入（宿主要求存在会话才能输入，因此自动创建是空白流程可用的前提）。
- 空白会话明确显示当前工作区状态；选择工作区后显示工作区名称，并提供 `X` 清除按钮。
- 点击 `X` 会清除当前会话工作区，回到「默认工作区」状态；若 `rootDirectory` 未配置或自动创建失败，也会回到该视图并提示（此时需先手动选择或创建才能输入）。
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

## 设置 UI

dsh 设置面板中有「时间戳工作区」分区：可选择或输入并保存 `rootDirectory`。设置值持久化到 `$DSH_HOME/storages/timestamp-workspace.json`，**优先于** `cordis.patch.yml` 里的配置；目录流对话框每次打开时会重新拉取最新配置，保存后无需重载即可生效。保存时会校验目录存在且为文件夹，不合法路径会被拒绝并提示错误，不会写入配置。
