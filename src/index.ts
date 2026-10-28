import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import { access, writeFile } from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { createServer } from './server'
import {
  fetchOpenApiIndex,
  extractOpenApiResources,
  filterResources,
  fetchOpenApiSpec
} from './openapi'
import { processSpec, extractProductsFromPaths } from './spec-processor'
import {
  config,
  ensureDataDir,
  getProductsPath,
  getSpecPath,
  getStorePath
} from './runtime'
import {
  initAuthClient,
  startAuth,
  handleAuthCallback,
  refreshIfNeeded
} from './auth'
import { createCliToken, deleteSession, getSession, getSessionIdForCliToken, setSession } from './store'

async function createMcpResponse(
  request: Request,
  token: string,
  userId?: string | null
): Promise<Response> {
  const server = await createServer(
    token,
    config.apiBase,
    getSpecPath(),
    getProductsPath(),
    userId
  )
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
    retryInterval: 1000
  })

  await server.connect(transport)
  const response = await transport.handleRequest(request)
  await transport.close()
  return response
}

async function refreshSpec(tokenOverride?: string): Promise<void> {
  await ensureDataDir()

  const token = tokenOverride || config.openapiToken
  if (!token) {
    console.warn('No token available for OpenAPI refresh; skipping.')
    return
  }

  const indexSpec = await fetchOpenApiIndex(config.apiBase, config.openapiIndexPath, token)
  const resources = extractOpenApiResources(indexSpec)
  let selected = filterResources(resources, config.openapiResources)

  if (Number.isFinite(config.openapiMaxResources) && config.openapiMaxResources > 0) {
    selected = selected.slice(0, config.openapiMaxResources)
  }

  if (selected.length === 0) {
    throw new Error('No OpenAPI resources selected. Check DATUM_OPENAPI_RESOURCES.')
  }

  const combinedPaths: Record<string, Record<string, unknown>> = {}
  for (const resource of selected) {
    const rawSpec = await fetchOpenApiSpec(config.apiBase, token, resource.serverRelativeURL)
    const processed = processSpec(rawSpec)
    for (const [path, methods] of Object.entries(processed.paths)) {
      combinedPaths[path] = methods
    }
  }

  const specJson = JSON.stringify({ paths: combinedPaths })
  const products = extractProductsFromPaths(combinedPaths)
  const productsJson = JSON.stringify(products)

  await Promise.all([
    writeFile(getSpecPath(), specJson),
    writeFile(getProductsPath(), productsJson)
  ])
}

async function bootstrapSpecRefresh(): Promise<void> {
  await ensureDataDir()
  const specPath = getSpecPath()
  const productsPath = getProductsPath()

  const specExists = await access(specPath, fsConstants.F_OK).then(() => true).catch(() => false)
  const productsExists = await access(productsPath, fsConstants.F_OK).then(() => true).catch(() => false)

  if (!specExists || !productsExists) {
    try {
      await refreshSpec()
    } catch (error) {
      console.warn('Spec refresh failed on startup:', error)
    }
  }

  if (config.openapiRefreshIntervalMs > 0) {
    setInterval(async () => {
      try {
        await refreshSpec()
      } catch (error) {
        console.warn('Spec refresh failed:', error)
      }
    }, config.openapiRefreshIntervalMs)
  }
}

async function ensureSpecAvailable(tokenOverride?: string): Promise<void> {
  const specPath = getSpecPath()
  const productsPath = getProductsPath()
  const specExists = await access(specPath, fsConstants.F_OK).then(() => true).catch(() => false)
  const productsExists = await access(productsPath, fsConstants.F_OK).then(() => true).catch(() => false)
  if (!specExists || !productsExists) {
    try {
      await refreshSpec(tokenOverride)
    } catch (error) {
      console.warn('Spec refresh failed after auth:', error)
    }
  }
}

async function main(): Promise<void> {
  await ensureDataDir()
  await initAuthClient()
  await bootstrapSpecRefresh()

  const app = new Hono()

  console.log(`Auth login: ${config.baseUrl}/auth/login`)

  if (config.logRequests) {
    app.use('*', async (c, next) => {
      const start = Date.now()
      let bodyPreview = ''
      if (config.logBodies) {
        try {
          const cloned = c.req.raw.clone()
          const text = await cloned.text()
          bodyPreview = text.length > 2000 ? `${text.slice(0, 2000)}…` : text
        } catch {
          bodyPreview = ''
        }
      }
      await next()
      const duration = Date.now() - start
      const status = c.res.status
      const line = `[mcp] ${c.req.method} ${c.req.path} ${status} ${duration}ms`
      if (bodyPreview) {
        console.log(`${line} body=${bodyPreview}`)
      } else {
        console.log(line)
      }
    })
  }

  app.get('/health', (c) => c.text('ok'))

  app.get('/auth/login', async (c) => {
    const { url, state, codeVerifier } = await startAuth()
    setCookie(c, config.sessionStateCookieName, state, config.cookieOptions)
    setCookie(c, config.sessionVerifierCookieName, codeVerifier, config.cookieOptions)
    return c.redirect(url)
  })

  app.get('/auth/callback', async (c) => {
    const state = getCookie(c, config.sessionStateCookieName) || ''
    const codeVerifier = getCookie(c, config.sessionVerifierCookieName) || ''

    if (!state || !codeVerifier) {
      return c.text('Missing auth state. Try /auth/login again.', 400)
    }

    const tokenSet = await handleAuthCallback(c.req.raw, state, codeVerifier)
    const sessionId = crypto.randomUUID()

    await setSession(sessionId, tokenSet, getStorePath())

    deleteCookie(c, config.sessionStateCookieName, config.cookieOptions)
    deleteCookie(c, config.sessionVerifierCookieName, config.cookieOptions)
    setCookie(c, config.sessionCookieName, sessionId, config.cookieOptions)

    await ensureSpecAvailable(tokenSet.accessToken || undefined)

    return c.text('Authenticated. You can now call /mcp.')
  })

  app.get('/auth/logout', async (c) => {
    const sessionId = getCookie(c, config.sessionCookieName)
    if (sessionId) {
      await deleteSession(sessionId, getStorePath())
    }
    deleteCookie(c, config.sessionCookieName, config.cookieOptions)
    return c.text('Logged out')
  })

  app.get('/auth/token', async (c) => {
    const sessionId = getCookie(c, config.sessionCookieName)
    if (!sessionId) {
      return c.json({ error: `Not authenticated. Open ${config.baseUrl}/auth/login` }, 401)
    }
    const session = await getSession(sessionId, getStorePath())
    if (!session) {
      return c.json({ error: `Session not found. Open ${config.baseUrl}/auth/login` }, 401)
    }
    const refreshed = await refreshIfNeeded(sessionId, session, getStorePath())
    if (!refreshed.accessToken) {
      return c.json({ error: `Session expired. Open ${config.baseUrl}/auth/login` }, 401)
    }
    const { token, expiresAt } = await createCliToken(
      sessionId,
      config.cliTokenTtlMs,
      getStorePath()
    )
    return c.json({
      token,
      expiresAt,
      authorization: `Bearer ${token}`
    })
  })

  app.post('/mcp', async (c) => {
    const authHeader = c.req.header('Authorization') || ''
    let sessionId = getCookie(c, config.sessionCookieName) || undefined
    if (!sessionId && authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice('Bearer '.length).trim()
      if (token) {
        const mappedSession = await getSessionIdForCliToken(token, getStorePath())
        if (mappedSession) {
          sessionId = mappedSession
        }
      }
    }
    if (!sessionId) {
      return c.json(
        { error: `Not authenticated. Open ${config.baseUrl}/auth/login` },
        401
      )
    }

    const session = await getSession(sessionId, getStorePath())
    if (!session) {
      return c.json(
        { error: `Session not found. Open ${config.baseUrl}/auth/login` },
        401
      )
    }

    const refreshed = await refreshIfNeeded(sessionId, session, getStorePath())
    if (!refreshed.accessToken) {
      return c.json(
        { error: `Session expired. Open ${config.baseUrl}/auth/login` },
        401
      )
    }

    return createMcpResponse(c.req.raw, refreshed.accessToken, refreshed.userId)
  })

  serve({ fetch: app.fetch, port: config.port })
  console.log(`Datum MCP running at ${config.baseUrl}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
