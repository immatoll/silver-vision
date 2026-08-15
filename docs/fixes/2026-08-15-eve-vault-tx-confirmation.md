# History: transaction confirmations not reaching the page

**Date:** 2026-08-15
**Shipped in:** PR #1 ("Track EveVault responses by dApp request"), merged into `main` as `a4d131b` / `a26f2de`.

## Symptom

After signing a transaction in the EVE Vault extension popup, the popup
closed and the transaction actually succeeded on-chain, but the dApp page
(e.g. silver-link, ef-map) stayed in a stuck "working" state — sometimes for
a full 10-minute timeout, sometimes forever. A manual page refresh always
"fixed" it because the transaction had, in fact, gone through; only the
in-app notification was lost.

This did **not** reproduce when using the EVE Vault extension in real Google
Chrome — only inside the Electron-based SilverVision app.

## Root cause

EVE Vault is a Manifest V3 extension. Its original design was:

1. The signing popup (`sign_transaction.html`) signs the transaction and
   writes the result to `chrome.storage.local`.
2. The background service worker has a `chrome.storage.onChanged` listener
   that wakes up when that write happens, and relays the result back to the
   dApp page.

**Electron's `session.extensions` implementation does not reliably dispatch
`chrome.storage.onChanged` events into an MV3 service worker's context.**
Real Chrome routes storage-change events into service workers via its
`EventRouter`; Electron 41's extension host doesn't implement that wake path
completely. The result: the popup's storage write always succeeded, but the
listener that was supposed to react to it often never fired — silently, with
no error anywhere. This is a platform-level gap in Electron, not a bug in EVE
Vault's own logic, which is why the same extension code works fine in real
Chrome.

A separate, compounding issue: EVE Vault's original listener was also
registered in an MV3-unsafe way — freshly, inside each signing request's
handler, rather than once at script load. Under normal Chromium
service-worker idle-termination, a listener like that can be lost on a
worker restart independent of the Electron bug above.

## Two independent fixes were built for this

Two people hit this bug at the same time and fixed it two different ways.
Keeping both approaches here for the record, since the trade-offs are worth
knowing if this area breaks again.

### Attempt 1 (superseded): direct message from the popup

Approach: stop relying on `chrome.storage.onChanged` to wake the service
worker at all. Instead, patch the popup to send
`chrome.runtime.sendMessage({type: 'EVEVAULT_TX_RESULT_READY', windowId,
requestId})` directly to the background script right after its storage write
resolves, and add a matching `onMessage` listener in the background script
that does the same match/dispatch work the broken `onChanged` listener was
supposed to do.

This worked, but had two real downsides:

- It required editing the **vendored, minified extension bundle directly**
  (`extension/eve-vault-0.14/background.js` and
  `extension/eve-vault-0.14/chunks/SignRequestView-jBUtQ6_5.js`) — there is
  no source or build step for that bundle in this repo. Any future
  re-vendoring of `eve-vault-0.14` would silently wipe the fix.
  Whoever maintains the EVE Vault build should be told about the underlying
  Electron `onChanged` limitation so a proper fix can land upstream instead.
- It still depended on the MV3 service worker being alive at message-receive
  time — a narrower version of the same problem, not a structural fix.

### Attempt 2 (shipped, PR #1 — "Track EveVault responses by dApp request")

Approach: don't fix the service worker's listener at all. Instead, add a
recovery path that never depends on the service worker being awake:

- `src/main/eve-vault-approval-recovery.js` — injected into the **persistent
  keeper page** (`keeper.html`), which is a normal, never-suspended extension
  page, not a service worker. It watches the same `pendingAction` /
  `transactionResult` storage keys directly, with retry/backoff
  (`scheduleRecovery`, capped retries), and only acts if EVE Vault's own
  background listener hasn't already delivered the result.
- `src/preload/overlay.js` — records each outgoing Wallet Standard request id
  per `WebContentsView` at document start, so responses can be routed to the
  *specific* page that asked, instead of broadcast to every open overlay.
- `src/main/index.js` — reworked `extension:relayTabMessage` from a
  fire-and-forget `ipcMain.on` broadcast into a targeted, validated
  `ipcMain.handle` request/response: it checks the response shape, strips
  token material, matches it to the tracked request id and origin, and waits
  for a `window.postMessage` confirmation round-trip (with timeout) before
  telling the extension the delivery succeeded.

This fix is architecturally sounder and was the one that shipped:

- It never touches the vendored extension bundle, so it survives future
  `eve-vault-0.14` upgrades.
- It doesn't depend on the MV3 service worker being alive — the keeper page
  recovers the result regardless.
- It adds real hardening that attempt 1 didn't have: origin validation,
  targeted (not broadcast) delivery, and a confirmation round-trip so a
  "delivered" result actually reached the page instead of just being sent.

Attempt 1's edits were reverted (`git stash`, not deleted from history) once
attempt 2 was confirmed working, since layering both wasn't safe — PR #1
changed the `extension:relayTabMessage` contract (`ipcMain.on` →
`ipcMain.handle`), which attempt 1's vendored-bundle edits weren't written
against.

See `AGENTS.md` for the current, authoritative description of the shipped
mechanism.
