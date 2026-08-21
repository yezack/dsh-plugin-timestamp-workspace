/**
 * Smoke-test the host half (lib/index.mjs) with a mocked webServer:
 * 1. apply() registers the /api/timestamp-workspace/settings route,
 * 2. GET returns the yaml-configured rootDirectory,
 * 3. PUT persists a new value and GET reflects it,
 * 4. a fresh apply (simulating restart) prefers the store over the yaml value.
 * Uses a throwaway DSH_HOME so the real profile store is never touched.
 */
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const fakeHome = mkdtempSync(join(tmpdir(), 'tsw-verify-'))
process.env.DSH_HOME = fakeHome

const { apply } = await import('../lib/index.mjs')

const yamlRoot = 'C:/yaml/configured/root'

function installServer() {
  const routes = new Map()
  const fakeCtx = {
    webServer: {
      register(desc) {
        routes.set(desc.path, desc.handler)
        return () => routes.delete(desc.path)
      },
    },
    logger: { info() {}, warn() {} },
    effect(fn) { return fn() },
    on() {},
  }
  apply(fakeCtx, { rootDirectory: yamlRoot })
  return routes
}

function request(routes, method, path, body) {
  const handler = routes.get(path)
  if (!handler) throw new Error(`no route for ${path}`)
  const chunks = []
  const req = {
    method,
    url: path,
    on(event, cb) {
      if (event === 'data' && body !== undefined) cb(Buffer.from(JSON.stringify(body)))
      if (event === 'end') cb()
      if (event === 'error') cb()
    },
  }
  const res = {
    writeHead(status, headers) { res.status = status; res.headers = headers },
    end(payload) { res.body = payload },
  }
  return handler(req, res).then(() => ({
    status: res.status,
    body: res.body === undefined ? undefined : JSON.parse(res.body),
  }))
}

const fail = (msg) => { rmSync(fakeHome, { recursive: true, force: true }); console.error(`FAIL: ${msg}`); process.exit(1) }

try {
  const routes = installServer()

  // GET with only yaml configured.
  let r = await request(routes, 'GET', '/api/timestamp-workspace/settings')
  if (r.status !== 200 || r.body.rootDirectory !== yamlRoot) fail(`GET should return yaml root, got ${JSON.stringify(r)}`)

  // PUT a new root, then GET again.
  const newRoot = 'C:/Users/yezac/Documents/dsh-workspaces'
  r = await request(routes, 'PUT', '/api/timestamp-workspace/settings', { rootDirectory: newRoot })
  if (r.status !== 200 || r.body.ok !== true || r.body.rootDirectory !== newRoot) fail(`PUT failed, got ${JSON.stringify(r)}`)

  r = await request(routes, 'GET', '/api/timestamp-workspace/settings')
  if (r.status !== 200 || r.body.rootDirectory !== newRoot) fail(`GET after PUT should return ${newRoot}, got ${JSON.stringify(r)}`)

  // Empty value rejected.
  r = await request(routes, 'PUT', '/api/timestamp-workspace/settings', { rootDirectory: '   ' })
  if (r.status !== 400) fail(`PUT with blank root should be 400, got ${JSON.stringify(r)}`)

  // Method not allowed.
  r = await request(routes, 'DELETE', '/api/timestamp-workspace/settings')
  if (r.status !== 405) fail(`DELETE should be 405, got ${JSON.stringify(r)}`)

  // Store file written.
  const storePath = join(fakeHome, 'storages', 'timestamp-workspace.json')
  if (!existsSync(storePath)) fail('store file not written')
  const persisted = JSON.parse(readFileSync(storePath, 'utf8'))
  if (persisted.rootDirectory !== newRoot) fail(`store content mismatch: ${JSON.stringify(persisted)}`)

  // Restart simulation: fresh apply (new routes) with the OLD yaml value —
  // the store must win.
  const routes2 = installServer()
  r = await request(routes2, 'GET', '/api/timestamp-workspace/settings')
  if (r.status !== 200 || r.body.rootDirectory !== newRoot) fail(`restart should prefer store, got ${JSON.stringify(r)}`)

  console.log('PASS: route registered, GET/PUT round-trip OK, validation OK, store persists, store wins over yaml on restart')
} catch (error) {
  fail(error instanceof Error ? error.message : String(error))
} finally {
  rmSync(fakeHome, { recursive: true, force: true })
}
