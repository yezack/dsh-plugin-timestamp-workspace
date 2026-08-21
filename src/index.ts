import z from '@deepseek-ai/schemastery'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'

export const name = 'timestamp-workspace'
export const inject: string[] = ['webServer']
export const Config = z.object({
  // schemastery fields are optional unless marked `.required()`: the yaml
  // value is the initial default, the settings UI overrides it via the store.
  rootDirectory: z.string()
})

const DSH_HOME = process.env.DSH_HOME ?? join(homedir(), '.dsh')
const STORE_PATH = join(DSH_HOME, 'storages', 'timestamp-workspace.json')

interface StoreData { rootDirectory?: string }

function readStore(): StoreData {
  try {
    const data = JSON.parse(readFileSync(STORE_PATH, 'utf8'))
    if (data && typeof data.rootDirectory === 'string' && data.rootDirectory.trim()) {
      return { rootDirectory: data.rootDirectory.trim() }
    }
  } catch { /* missing or corrupt store: fall through to defaults */ }
  return {}
}

function writeStore(rootDirectory: string): void {
  mkdirSync(dirname(STORE_PATH), { recursive: true })
  const tmp = STORE_PATH + '.tmp'
  writeFileSync(tmp, JSON.stringify({ version: 1, rootDirectory }, null, 2))
  renameSync(tmp, STORE_PATH)
}

function json(res: { writeHead(status: number, headers: Record<string, string>): void; end(body: string): void }, status: number, body: unknown): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(body))
}

function readBody(req: { on(event: 'data', cb: (chunk: Buffer) => void): void; on(event: 'end', cb: () => void): void; on(event: 'error', cb: () => void): void }, cap = 64 * 1024): Promise<string | null> {
  return new Promise((resolve) => {
    let size = 0
    const parts: Buffer[] = []
    let settled = false
    const done = (value: string | null) => { if (!settled) { settled = true; resolve(value) } }
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size <= cap) parts.push(chunk)
      else done(null)
    })
    req.on('end', () => done(Buffer.concat(parts).toString('utf8')))
    req.on('error', () => done(null))
  })
}

/** Host half: filesystem operations are provided by the official Workspace service. */
export function apply(ctx: { webServer: { register(desc: { kind: string; path: string; handler(req: unknown, res: unknown): void }): () => void }; logger?: { info(msg: string): void; warn(msg: string): void } }, config?: { rootDirectory?: string }): void {
  const yamlRoot = typeof config?.rootDirectory === 'string' ? config.rootDirectory.trim() : ''
  const resolveRoot = (): string => {
    // The settings UI persists into the store; the store wins over the
    // cordis.patch.yml value (the yaml value acts as the initial default).
    const stored = readStore()
    return stored.rootDirectory ?? yamlRoot
  }

  ctx.effect?.(() => {
    const dispose = ctx.webServer.register({
      kind: 'exact',
      path: '/api/timestamp-workspace/settings',
      handler: async (req: any, res: any) => {
        if (req.method === 'GET') {
          return json(res, 200, { rootDirectory: resolveRoot() })
        }
        if (req.method !== 'PUT') {
          return json(res, 405, { ok: false, error: 'method-not-allowed' })
        }
        const body = await readBody(req)
        let payload: unknown
        try { payload = JSON.parse(body ?? '{}') } catch { return json(res, 400, { ok: false, error: 'bad-json' }) }
        const root = (payload as { rootDirectory?: unknown })?.rootDirectory
        if (typeof root !== 'string' || !root.trim()) {
          return json(res, 400, { ok: false, error: 'rootDirectory 不能为空' })
        }
        const trimmed = root.trim()
        writeStore(trimmed)
        ctx.logger?.info?.(`[timestamp-workspace] rootDirectory -> ${trimmed}`)
        return json(res, 200, { ok: true, rootDirectory: trimmed })
      },
    })
    return dispose
  }, 'timestamp-workspace: /api/timestamp-workspace/settings')
}
