# dsh-plugin-timestamp-workspace

DeepSeek Harness 工作区插件：用户可以选择已有目录，也可以不选择目录，直接在配置根目录下自动创建按本地时间命名的工作区。

## 行为

- **「新会话」保持官方原逻辑**：插件不劫持新会话，点击「新会话」仍进入官方「选择一个工作区」流程。
- 在官方选择工作区入口（hero 的「选择工作区」行）旁新增「开启临时会话」按钮：点击后在 `rootDirectory` 下创建 `yyyyMMddHHmmss` 文件夹，并以该文件夹为 cwd 打开一个**不注册为工作区**的临时会话（归入侧边栏未分组），可直接输入对话。
- 「添加工作区」保持官方原生流程（应用内浏览 / 原生目录选择器），插件不再占用目录流插槽。
- 临时会话在侧边栏「未分组」分组中置顶显示：组名带计数「未分组 (N)」与虚线边框样式；组内空白会话行显示「新的临时会话」。
- 开启新临时会话前会自动清理已归档的空白临时会话目录；归档空白临时会话时自动删除其文件夹。
- **批量归档**：侧边栏「未分组」行右侧新增「…」按钮，点击弹出宿主样式菜单 →「批量归档」；对话框列出未分组（临时）会话，多选（支持全选/清空）后二次确认，再逐个归档。按钮/菜单/对话框复用宿主图标、Menu/Modal/Button 与设计令牌，样式与宿主一致。
- 应用启动时恢复官方默认行为（自动恢复上一次工作区）。

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

插件通过公开的 `conversation.composer` takeover chain，仅接管“有 cwd、没有 workspaceId”的临时会话输入框；正式工作区继续使用 dsh 原生输入框，不修改 DSH Desktop 文件。点击 hero 的「开启临时会话」会在 `rootDirectory/yyyyMMddHHmmss` 创建目录，进入未分组临时会话后即可直接输入。

## 设置 UI

dsh 设置面板中有「时间戳工作区」分区：可选择或输入并保存 `rootDirectory`。设置值持久化到 `$DSH_HOME/storages/timestamp-workspace.json`，**优先于** `cordis.patch.yml` 里的配置；每次点击「开启临时会话」时都会重新拉取最新配置，保存后无需重载即可生效。保存时会校验目录存在且为文件夹，不合法路径会被拒绝并提示错误，不会写入配置。
