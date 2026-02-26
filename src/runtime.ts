import { mkdir } from 'node:fs/promises'
import path from 'node:path'

const cwd = process.cwd()
const dataDir = process.env.DATUM_DATA_DIR || path.join(cwd, 'data')

const port = Number.parseInt(process.env.PORT || '8787', 10)
const baseUrl = process.env.BASE_URL || `http://localhost:${port}`

const cookieSecure = process.env.NODE_ENV === 'production'

const STAGING_CLIENT_ID = '325848904128073754'
const PROD_CLIENT_ID = '328728232771788043'

function deriveClientId(issuer: string): string {
  try {
    const hostname = new URL(issuer).hostname
    if (hostname.endsWith('.staging.env.datum.net')) {
      return STAGING_CLIENT_ID
    }
    if (hostname.endsWith('.datum.net')) {
      return PROD_CLIENT_ID
    }
  } catch {
    // ignore parse failures
  }
  return ''
}

export const config = {
  apiBase: process.env.DATUM_API_BASE || 'https://api.datum.net',
  openapiIndexPath: process.env.DATUM_OPENAPI_INDEX_PATH || '/openapi/v3',
  openapiResources: process.env.DATUM_OPENAPI_RESOURCES
    ? process.env.DATUM_OPENAPI_RESOURCES.split(',').map((r) => r.trim()).filter(Boolean)
    : undefined,
  openapiMaxResources: Number.parseInt(process.env.DATUM_OPENAPI_MAX_RESOURCES || '200', 10),
  openapiToken: process.env.DATUM_OPENAPI_TOKEN,
  openapiRefreshIntervalMs: Number.parseInt(
    process.env.OPENAPI_REFRESH_INTERVAL_MS || String(24 * 60 * 60 * 1000),
    10
  ),
  authIssuer: process.env.AUTH_OIDC_ISSUER || 'https://auth.datum.net',
  authClientId:
    process.env.AUTH_OIDC_CLIENT_ID ||
    deriveClientId(process.env.AUTH_OIDC_ISSUER || 'https://auth.datum.net'),
  authClientSecret: process.env.AUTH_OIDC_CLIENT_SECRET || '',
  authScopes:
    process.env.AUTH_OIDC_SCOPES?.split(' ').filter(Boolean) ||
    ['openid', 'profile', 'email', 'offline_access'],
  authRedirectUri: process.env.AUTH_OIDC_REDIRECT_URI || `${baseUrl}/auth/callback`,
  authRefreshWindowMs: Number.parseInt(
    process.env.AUTH_REFRESH_WINDOW_MS || String(60 * 60 * 1000),
    10
  ),
  sessionCookieName: process.env.AUTH_SESSION_COOKIE || 'datum_mcp_session',
  sessionStateCookieName: process.env.AUTH_STATE_COOKIE || 'datum_mcp_state',
  sessionVerifierCookieName: process.env.AUTH_VERIFIER_COOKIE || 'datum_mcp_verifier',
  port,
  baseUrl,
  dataDir,
  specPath: process.env.DATUM_SPEC_PATH || path.join(dataDir, 'spec.json'),
  productsPath: process.env.DATUM_PRODUCTS_PATH || path.join(dataDir, 'products.json'),
  storePath: process.env.DATUM_TOKEN_STORE_PATH || path.join(dataDir, 'sessions.json'),
  cookieOptions: {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: cookieSecure,
    path: '/'
  },
  logRequests: process.env.MCP_LOG_REQUESTS === '1',
  logBodies: process.env.MCP_LOG_BODIES === '1',
  logApiRequests: process.env.MCP_LOG_API_REQUESTS === '1',
  logApiResponses: process.env.MCP_LOG_API_RESPONSES === '1',
  cliTokenTtlMs: Number.parseInt(process.env.MCP_CLI_TOKEN_TTL_MS || String(10 * 60 * 1000), 10)
}

export async function ensureDataDir(): Promise<void> {
  await mkdir(config.dataDir, { recursive: true })
}

export function getSpecPath(): string {
  return config.specPath
}

export function getProductsPath(): string {
  return config.productsPath
}

export function getStorePath(): string {
  return config.storePath
}
