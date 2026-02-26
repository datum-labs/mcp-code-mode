import * as client from 'openid-client'
import { config } from './runtime'
import { updateSession, type SessionTokens } from './store'

let configuration: client.Configuration | null = null

export async function initAuthClient(): Promise<void> {
  if (!config.authIssuer || !config.authClientId) {
    throw new Error(
      'AUTH_OIDC_ISSUER and AUTH_OIDC_CLIENT_ID are required (or use a known Datum issuer to derive a default client id)'
    )
  }

  const issuerUrl = new URL(config.authIssuer)
  configuration = await client.discovery(
    issuerUrl,
    config.authClientId,
    config.authClientSecret || undefined
  )
}

function getClient() {
  if (!configuration) throw new Error('Auth client not initialized')
  return configuration
}

export async function startAuth(): Promise<{
  url: string
  state: string
  codeVerifier: string
}> {
  const codeVerifier = client.randomPKCECodeVerifier()
  const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier)
  const state = client.randomState()

  const url = client.buildAuthorizationUrl(getClient(), {
    scope: config.authScopes.join(' '),
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    redirect_uri: config.authRedirectUri
  })

  return { url: url.toString(), state, codeVerifier }
}

export async function handleAuthCallback(
  request: Request,
  state: string,
  codeVerifier: string
): Promise<SessionTokens> {
  const tokenSet = await client.authorizationCodeGrant(getClient(), request, {
    expectedState: state,
    pkceCodeVerifier: codeVerifier
  })
  return tokenSetToSession(tokenSet)
}

export async function refreshIfNeeded(
  sessionId: string,
  session: SessionTokens,
  storePath: string
): Promise<SessionTokens & { accessToken: string | null }> {
  if (!session.accessToken) {
    return { ...session, accessToken: null }
  }

  if (!session.expiresAt) {
    return { ...session, accessToken: session.accessToken }
  }

  const expiryMs = session.expiresAt * 1000
  const now = Date.now()
  const refreshAt = expiryMs - config.authRefreshWindowMs

  if (now < refreshAt) {
    return { ...session, accessToken: session.accessToken }
  }

  if (!session.refreshToken) {
    return { ...session, accessToken: null }
  }

  try {
    const tokenSet = await client.refreshTokenGrant(getClient(), session.refreshToken)
    const next = tokenSetToSession(tokenSet)
    const refreshToken = next.refreshToken ?? session.refreshToken
    const updated: SessionTokens = {
      ...next,
      refreshToken,
      updatedAt: Date.now()
    }
    await updateSession(sessionId, updated, storePath)
    return { ...updated, accessToken: updated.accessToken || null }
  } catch {
    return { ...session, accessToken: null }
  }
}

function tokenSetToSession(tokenSet: client.TokenEndpointResponse): SessionTokens {
  const idToken = tokenSet.id_token ?? null
  return {
    accessToken: tokenSet.access_token ?? undefined,
    refreshToken: tokenSet.refresh_token ?? null,
    expiresAt: tokenSet.expires_in ? Math.floor(Date.now() / 1000) + tokenSet.expires_in : null,
    idToken,
    userId: idToken ? decodeJwtSub(idToken) : null,
    updatedAt: Date.now()
  }
}

function decodeJwtSub(token: string): string | null {
  const parts = token.split('.')
  if (parts.length < 2) return null
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8')) as {
      sub?: string
    }
    return payload.sub ?? null
  } catch {
    return null
  }
}

// Session update handled in refreshIfNeeded
