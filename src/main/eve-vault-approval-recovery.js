'use strict'

const DEFAULT_STORAGE_CHANGE_DELAY_MS = 75
const DEFAULT_RETRY_DELAY_MS = 250
const DEFAULT_MAX_RETRIES = 4

function nonNegativeInteger(value, fallback) {
  return Number.isInteger(value) && value >= 0 ? value : fallback
}

/**
 * Builds the script installed in the persistent EVE Vault keeper page.
 *
 * Manifest V3 can suspend the extension background worker while an approval
 * popup is open. The popup still writes pendingAction/transactionResult to
 * extension storage, so the keeper can safely finish delivery when the
 * background worker misses that storage event.
 */
function createEveVaultApprovalRecoveryScript(options = {}) {
  const storageChangeDelayMs = nonNegativeInteger(
    options.storageChangeDelayMs,
    DEFAULT_STORAGE_CHANGE_DELAY_MS
  )
  const retryDelayMs = nonNegativeInteger(options.retryDelayMs, DEFAULT_RETRY_DELAY_MS)
  const maxRetries = nonNegativeInteger(options.maxRetries, DEFAULT_MAX_RETRIES)

  return `
    (() => {
      const INSTALL_KEY = '__efcEveVaultApprovalRecoveryInstalled';
      if (window[INSTALL_KEY]) return;
      if (
        typeof chrome === 'undefined' ||
        !chrome.storage ||
        !chrome.storage.local ||
        !chrome.storage.onChanged ||
        typeof window.__efcKeeperIpc === 'undefined'
      ) return;

      window[INSTALL_KEY] = true;

      const STORAGE_KEYS = ['pendingAction', 'transactionResult'];
      const STORAGE_CHANGE_DELAY_MS = ${storageChangeDelayMs};
      const RETRY_DELAY_MS = ${retryDelayMs};
      const MAX_RETRIES = ${maxRetries};
      let recoveryInFlight = null;
      let scheduledRecovery = null;

      const isRecord = (value) =>
        value !== null && typeof value === 'object' && !Array.isArray(value);
      const isRequestId = (value) =>
        typeof value === 'string' && value.length > 0 && value.length <= 128;
      const isString = (value) => typeof value === 'string';

      function errorMessage(value) {
        if (typeof value === 'string' && value.length > 0) return value;
        if (isRecord(value) && typeof value.message === 'string') return value.message;
        return 'Unknown error occurred';
      }

      function signingErrorType(action) {
        if (action === 'sign_personal_message') return 'sign_personal_message_error';
        if (action === 'sign_transaction') return 'sign_transaction_error';
        if (action === 'sign_and_execute_transaction') {
          return 'sign_and_execute_transaction_error';
        }
        return 'sign_error';
      }

      function matchingApproval(pending, result) {
        return (
          isRecord(pending) &&
          isRecord(result) &&
          isRequestId(pending.id) &&
          isRequestId(pending.requestId) &&
          pending.requestId === result.requestId &&
          Number.isInteger(pending.windowId) &&
          pending.windowId === result.windowId &&
          Number.isInteger(pending.senderTabId) &&
          typeof pending.action === 'string'
        );
      }

      function pageDelivery(pending, result) {
        if (!matchingApproval(pending, result)) return null;

        const base = { id: pending.id };
        if (result.status === 'error') {
          return {
            tabId: pending.senderTabId,
            message: {
              ...base,
              type: signingErrorType(pending.action),
              error: errorMessage(result.error)
            }
          };
        }

        if (
          result.status === 'signed' &&
          (pending.action === 'sign_personal_message' ||
            pending.action === 'sign_transaction') &&
          isString(result.bytes) &&
          isString(result.signature)
        ) {
          return {
            tabId: pending.senderTabId,
            message: {
              ...base,
              type: 'sign_success',
              bytes: result.bytes,
              signature: result.signature
            }
          };
        }

        if (
          result.status === 'signed_and_executed' &&
          pending.action === 'sign_and_execute_transaction' &&
          isString(result.bytes) &&
          isString(result.signature) &&
          isString(result.digest) &&
          isString(result.effects)
        ) {
          return {
            tabId: pending.senderTabId,
            message: {
              ...base,
              type: 'sign_and_execute_transaction_success',
              result: {
                bytes: result.bytes,
                signature: result.signature,
                digest: result.digest,
                effects: result.effects
              }
            }
          };
        }

        return null;
      }

      async function clearMatchingApproval(pending, result) {
        const latest = await chrome.storage.local.get(STORAGE_KEYS);
        if (!matchingApproval(latest.pendingAction, latest.transactionResult)) return;
        if (
          latest.pendingAction.requestId !== pending.requestId ||
          latest.transactionResult.requestId !== result.requestId
        ) return;
        await chrome.storage.local.remove(STORAGE_KEYS);
      }

      async function recoverOnce() {
        if (recoveryInFlight) return recoveryInFlight;

        recoveryInFlight = (async () => {
          const stored = await chrome.storage.local.get(STORAGE_KEYS);
          const pending = stored.pendingAction;
          const result = stored.transactionResult;
          const delivery = pageDelivery(pending, result);
          if (!delivery) return 'idle';

          const confirmation = await window.__efcKeeperIpc.relayTabMessage(delivery);
          if (!confirmation || confirmation.confirmed !== true) return 'retry';

          await clearMatchingApproval(pending, result);
          console.info('[SilverVision] Recovered EVE Vault approval result', {
            id: pending.id,
            type: delivery.message.type
          });
          return 'delivered';
        })()
          .catch((error) => {
            console.error('[SilverVision] Failed to recover EVE Vault approval result', error);
            return 'retry';
          })
          .finally(() => {
            recoveryInFlight = null;
          });

        return recoveryInFlight;
      }

      function scheduleRecovery(attempt, delay) {
        if (scheduledRecovery !== null) clearTimeout(scheduledRecovery);
        scheduledRecovery = setTimeout(async () => {
          scheduledRecovery = null;
          const status = await recoverOnce();
          if (status === 'retry' && attempt < MAX_RETRIES) {
            scheduleRecovery(attempt + 1, RETRY_DELAY_MS * (attempt + 1));
          }
        }, delay);
      }

      chrome.storage.onChanged.addListener((changes, areaName) => {
        if (
          areaName !== 'local' ||
          !changes ||
          !changes.transactionResult ||
          changes.transactionResult.newValue === undefined
        ) return;

        // Let EVE Vault's normal background listener win when it is still
        // alive. Recovery runs only if the result remains in storage.
        scheduleRecovery(0, STORAGE_CHANGE_DELAY_MS);
      });

      // A completed result may predate this keeper page after an app restart.
      scheduleRecovery(0, 0);
    })()
  `
}

module.exports = { createEveVaultApprovalRecoveryScript }
