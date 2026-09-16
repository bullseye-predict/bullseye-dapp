import {
  createDynamicClient,
  signInWithSocialRedirect,
  initializeClient,
  refreshAuth,
  signMessage,
  type DynamicClient,
} from '@dynamic-labs-sdk/client'
import {
  createWaasWalletAccounts,
  getChainsMissingWaasWalletAccounts,
  isDynamicWaasEnabled,
} from '@dynamic-labs-sdk/client/waas'
import { getCore } from '@dynamic-labs-sdk/client/core'
import { createApiClient, createStorageKeySchema, getSessionKeys, updateAuthFromVerifyResponse } from '@dynamic-labs-sdk/client/core'
import { addSolanaExtension } from '@dynamic-labs-sdk/solana'
import * as z from 'zod/mini'
import { cancelTelegramOAuthPopup, navigateDynamicAuth, prepareTelegramOAuthPopup, takeTelegramOAuthCallbackUrl } from './telegramOAuthPopup'

const clients = new Map<string, DynamicClient>()
const initializations = new WeakMap<DynamicClient, Promise<void>>()
const provisioning = new WeakMap<DynamicClient, Promise<void>>()
const refreshes = new WeakMap<DynamicClient, Promise<void>>()
const keepaliveClients = new WeakSet<DynamicClient>()

const RECOVERABLE_AUTH_ERROR =
  /secure token exchange|initialize waas client with auth token|authorization header or cookie is required|session expired|status code\s*401/i

const telegramRedirectStateStorageKey = createStorageKeySchema({
  key: 'redirectState',
  schema: z.optional(z.object({
    codeVerifier: z.optional(z.string()),
    provider: z.literal('telegram'),
    state: z.string(),
  })) as never,
})

function normalizeProjectSettings(client: DynamicClient) {
  const core = getCore(client)
  core.state.subscribe((state) => {
    const settings = state.projectSettings
    if (!settings) return
    const authStorage = settings.security?.auth?.storage ?? []
    const sandboxCookieWithoutCustomApi =
      String(settings.environmentName ?? '').toLowerCase() === 'sandbox' &&
      core.apiBaseUrl === 'https://app.dynamicauth.com/api/v0' &&
      authStorage.some(value => String(value) === 'cookie')
    const invalidRelay = settings.sdk?.waas?.customKeyshareRelayBaseUrl === 'undefined'
    if (!sandboxCookieWithoutCustomApi && !invalidRelay) return

    // This is the same bounded compatibility fix used by zero-engine. Dynamic's
    // Sandbox currently advertises cookie auth against its shared API and an
    // unset relay as the literal string "undefined". The WaaS iframe otherwise
    // starts without a usable credential and fails its token exchange with 401.
    core.state.set({
      projectSettings: ({
        ...settings,
        security: sandboxCookieWithoutCustomApi
          ? {
              ...settings.security,
              auth: { ...settings.security?.auth, storage: ['localstorage'] as typeof authStorage },
            }
          : settings.security,
        sdk: invalidRelay
          ? {
              ...settings.sdk,
              waas: { ...settings.sdk?.waas, customKeyshareRelayBaseUrl: undefined },
            }
          : settings.sdk,
      }) as typeof settings,
    })
  })
}

export function predictionDynamicClient(environmentId: string) {
  const key = environmentId
  const existing = clients.get(key)
  if (existing) return existing
  const client = createDynamicClient({
    autoInitialize: false,
    coreConfig: { navigate: navigateDynamicAuth },
    environmentId,
    metadata: { name: 'SOLZ / ODDS', universalLink: window.location.origin },
    waas: { loadTimeoutMs: 12_000, maxLoadRetries: 1 },
  })
  normalizeProjectSettings(client)
  clients.set(key, client)
  return client
}

export function initializePredictionDynamicClient(client: DynamicClient) {
  const existing = initializations.get(client)
  if (existing) return existing
  const work = (async () => {
    addSolanaExtension(client)
    await initializeClient(client)
    installAuthKeepalive(client)
  })().catch((error) => {
    initializations.delete(client)
    throw error
  })
  initializations.set(client, work)
  return work
}

export function hasDynamicAuthentication(client: DynamicClient) {
  const storage = client.projectSettings?.security?.auth?.storage ?? []
  return Boolean(client.user && (client.token || storage.some(value => String(value) === 'cookie')))
}

export function refreshDynamicAuthentication(client: DynamicClient) {
  const existing = refreshes.get(client)
  if (existing) return existing
  const work = refreshAuth(client).then(() => undefined).finally(() => refreshes.delete(client))
  refreshes.set(client, work)
  return work
}

function installAuthKeepalive(client: DynamicClient) {
  if (keepaliveClients.has(client)) return
  keepaliveClients.add(client)
  const refreshWhileActive = () => {
    if (document.visibilityState !== 'visible' || !client.user) return
    void refreshDynamicAuthentication(client).catch(() => {
      // Dynamic remains the authority for a revoked session. A transient
      // refresh failure must not turn the cached identity into a fake logout.
    })
  }
  window.setInterval(refreshWhileActive, 5 * 60 * 1_000)
  window.addEventListener('focus', refreshWhileActive)
  document.addEventListener('visibilitychange', refreshWhileActive)
  refreshWhileActive()
}

export async function ensureSolanaWaasAccount(client: DynamicClient) {
  if (!client.user || !hasDynamicAuthentication(client)) return false
  if (!isDynamicWaasEnabled(client)) throw new Error('Dynamic WaaS is not enabled for this environment.')
  if (!getChainsMissingWaasWalletAccounts(client).includes('SOL')) return true
  const existing = provisioning.get(client)
  if (existing) {
    await existing
    return true
  }
  const work = createWaasWalletAccounts({ chains: ['SOL'] }, client)
    .then(() => {
      if (getChainsMissingWaasWalletAccounts(client).includes('SOL')) {
        throw new Error('Dynamic completed setup without returning the Solana WaaS account.')
      }
    })
    .finally(() => provisioning.delete(client))
  provisioning.set(client, work)
  await work
  return true
}

export async function withDynamicAuthRecovery<T>(client: DynamicClient, operation: () => Promise<T>) {
  try {
    return await operation()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error ?? '')
    if (!client.user || !RECOVERABLE_AUTH_ERROR.test(message)) throw error
    await refreshDynamicAuthentication(client)
    return operation()
  }
}

export async function signDynamicMessage(client: DynamicClient, walletAccount: Parameters<typeof signMessage>[0]['walletAccount'], message: Uint8Array) {
  return withDynamicAuthRecovery(client, () => signMessage({
    message: new TextDecoder().decode(message),
    walletAccount,
  }, client))
}

export async function signInWithTelegram(client: DynamicClient) {
  prepareTelegramOAuthPopup()
  try {
    await signInWithSocialRedirect({ provider: 'telegram' as never, redirectUrl: window.location.href }, client)
    const callback = takeTelegramOAuthCallbackUrl()
    if (!callback) throw new Error('Telegram did not return a verified callback.')
    const state = callback.searchParams.get('dynamicOauthState')
    const code = callback.searchParams.get('dynamicOauthCode')
    if (!state || !code) throw new Error('Telegram returned an incomplete callback.')
    const core = getCore(client)
    const redirectState = await core.storage.getItem(telegramRedirectStateStorageKey)
    if (!redirectState || typeof redirectState !== 'object' || !('state' in redirectState) || redirectState.state !== state) throw new Error('Telegram returned an expired security state.')
    const response = await createApiClient({}, client).telegramSignIn({
      environmentId: core.environmentId,
      oauthResultRequest: {
        code,
        forceCreateUser: true,
        sessionPublicKey: getSessionKeys(client)?.publicKey,
        state,
      },
    })
    await core.storage.removeItem(telegramRedirectStateStorageKey)
    updateAuthFromVerifyResponse({ response }, client)
    return response.user
  } catch (error) {
    cancelTelegramOAuthPopup()
    throw error
  }
}
