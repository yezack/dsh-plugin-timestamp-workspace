/**
 * Patch the installed DSH Desktop host bundle so workspace-less (temporary)
 * conversations can start typing without picking a workspace.
 *
 * The host (dsh-client-ui-conversation) locks the hero composer when a blank
 * session has no workspace chip:
 *   const inert = sessionId === void 0 || hero && chipTitle === void 0;
 * and only derives a chip label from a session cwd while the workspace
 * baseline is still loading:
 *   chipTitle = ... ?? (workspaces.phase === "ready" || cwd === void 0
 *       || cwd === "" ? void 0 : workspaceLabel(cwd));
 * A temporary task session (created with a cwd but no registered workspace)
 * therefore stays locked forever. This script makes two one-line changes:
 *   1. let the cwd label win regardless of the baseline phase, and
 *   2. keep a blank session with a cwd unlocked.
 *
 * Usage:
 *   node scripts/patch-host-temp-chat.mjs            # apply (idempotent)
 *   node scripts/patch-host-temp-chat.mjs --check    # report state
 *   node scripts/patch-host-temp-chat.mjs --revert   # restore the backup
 *
 * The target lives under the app install dir; run this once elevated
 * (e.g. Start-Process node ... -Verb RunAs), and re-apply after app
 * updates. Override the path with DSH_CONVERSATION_BUNDLE if needed.
 */
import { existsSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs'

const target = process.env.DSH_CONVERSATION_BUNDLE
  ?? 'C:/Program Files/DSH Desktop/resources/app.asar.unpacked/node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/client.js'
const backup = `${target}.bak-temp-chat`

// chipTitle: drop the `workspaces.phase === "ready" ||` guard so a session
// cwd always provides a label (temporary task shows its folder name).
const CHIP_OLD = '(workspaces.phase === "ready" || cwd === void 0 || cwd === "" ? void 0 : workspaceLabel(cwd))'
const CHIP_NEW = '(cwd === void 0 || cwd === "" ? void 0 : workspaceLabel(cwd))'
// inert: a blank session WITH a cwd (temp task) must not be locked.
const INERT_OLD = 'const inert = sessionId === void 0 || hero && chipTitle === void 0;'
const INERT_NEW = 'const inert = sessionId === void 0 || hero && chipTitle === void 0 && cwd === void 0;'

const mode = process.argv.includes('--revert')
  ? 'revert'
  : process.argv.includes('--check')
    ? 'check'
    : 'apply'

const fail = (message) => {
  console.error(`[patch-host-temp-chat] FAIL: ${message}`)
  process.exit(1)
}

if (!existsSync(target)) fail(`bundle not found: ${target}`)
const source = readFileSync(target, 'utf8')

const patched = source.includes(CHIP_NEW) && source.includes(INERT_NEW)
const pristine = source.includes(CHIP_OLD) && source.includes(INERT_OLD)

if (mode === 'check') {
  if (patched) {
    console.log('[patch-host-temp-chat] PATCHED (temp conversations unlocked)')
  } else if (pristine) {
    console.log('[patch-host-temp-chat] NOT patched (original host logic)')
  } else {
    console.log('[patch-host-temp-chat] UNKNOWN state (unexpected content)')
  }
  process.exit(0)
}

if (mode === 'revert') {
  if (!existsSync(backup)) fail(`no backup at ${backup}`)
  writeFileSync(target, readFileSync(backup))
  console.log(`[patch-host-temp-chat] reverted from ${backup}`)
  process.exit(0)
}

// apply
if (patched) {
  console.log('[patch-host-temp-chat] already patched, nothing to do')
  process.exit(0)
}
if (!pristine) fail('bundle content does not match the expected host version; refusing to patch')

if (!existsSync(backup)) copyFileSync(target, backup)
let next = source
if (!next.includes(CHIP_OLD)) fail('chipTitle pattern not found')
next = next.replace(CHIP_OLD, CHIP_NEW)
if (!next.includes(INERT_OLD)) fail('inert pattern not found')
next = next.replace(INERT_OLD, INERT_NEW)
writeFileSync(target, next)

// verify
const check = readFileSync(target, 'utf8')
if (!check.includes(CHIP_NEW) || !check.includes(INERT_NEW)) fail('verification failed after write')
console.log(`[patch-host-temp-chat] patched ${target} (backup: ${backup})`)
