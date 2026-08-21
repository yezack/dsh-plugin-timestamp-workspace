# dsh-plugin-timestamp-workspace 项目长期笔记

## dsh 插件开发协议要点（实测）

### patch 注册格式（cordis.patch.yml）
- **顶层条目只有两种合法形式**：`{id: ...}`（targeted override/disable，无 id 直接报 `id is required for non-insert patches`）和 `{insert: [{id, name, config}]}`（新增插件/服务）。
- **bare 插件条目 `- <pkg>:` 会被 patch loader 拒绝** → 服务端插件根本不加载。
- 服务端不加载的表现：client UI 正常（web 端 bundle 自动扫描 node_modules，不走 patch），但插件自己的 fenced route（webServer）404。两条加载路径完全独立。
- 正确示例（wallet 同款）：
  ```yaml
  - insert:
      - id: timestamp-workspace
        name: dsh-plugin-timestamp-workspace
        config:
          rootDirectory: C:/Users/yezac/Documents/dsh-workspaces
  ```
- **patch 文件热更新**：改完 cordis.patch.yml 后 dsh 服务自动生效，无需重启。
- 诊断：`dsh --profile web --dump-config`（在 npx 缓存 `AppData/Local/npm-cache/_npx/<hash>/node_modules/@deepseek-ai/dsh/lib/bin.js`，跑前 `NODE_OPTIONS= ELECTRON_RUN_AS_NODE=` 清环境变量）看合并树与 patch 报错；`curl http://127.0.0.1:3080/api/<ns>/...` 验证路由。

### 服务端 fenced route（settings UI 用）
- `inject: ['webServer']` + `ctx.effect(() => ctx.webServer.register({kind: 'exact', path: '/api/<ns>/...', handler(req,res)}))`。
- 持久化：`$DSH_HOME/storages/<ns>.json`（tmp+rename 原子写），UI 存储值优先于 yaml。
- schemastery 字段默认 optional，`.required()` 才必填；**无 `.optional()` 方法**。

### client bundle（rc.6）
- 必须 classic script + `window.__ModuleLoader__.load({id: <包名>, factory})`，id 必须等于包名；exports 含 name/inject/apply。
- slots：single slot shadow 需换 priority（宿主 x6 占 priority 0，插件用 -1）。

## 构建与部署
- `npm run bundle` = tsdown + scripts/build-client.mjs；验证脚本在 test/。
- 部署目标：`~/.dsh/profiles/web/node_modules/dsh-plugin-timestamp-workspace/`（lib/index.mjs、lib/client.js、*.d.mts、package.json、README*）。
- 改完客户端产物需重启桌面应用；改 patch 或服务端产物可热更新（fenced route 立即生效）。
