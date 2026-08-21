import assert from 'node:assert/strict'
import { createTimestampWorkspace } from '../lib/client.mjs'

const calls = []
const result = await createTimestampWorkspace(async (root, name) => { calls.push({ root, name }); return root + '/' + name }, '  C:/workspaces  ', new Date(2026, 2, 8, 5, 6, 7))
assert.equal(result, 'C:/workspaces/20260308050607')
assert.deepEqual(calls, [{ root: 'C:/workspaces', name: '20260308050607' }])
await assert.rejects(() => createTimestampWorkspace(async () => 'unused', '   '), /rootDirectory 未配置/)
console.log('timestamp workspace tests passed')
