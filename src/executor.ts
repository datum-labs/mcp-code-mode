import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { config } from './runtime'

type DatumRequestOptions = {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  path: string
  query?: Record<string, string | number | boolean | undefined>
  body?: unknown
  contentType?: string
  rawBody?: boolean
  organizationId?: string
  projectId?: string
}

type DatumResponse<T = unknown> = { status: number; result: T }

function buildUrl(base: string, path: string): URL {
  const baseUrl = new URL(base)
  const rel = new URL(path, 'http://datum.local')
  const basePath = baseUrl.pathname.replace(/\/$/, '')
  baseUrl.pathname = `${basePath}${rel.pathname}`
  baseUrl.search = rel.search
  baseUrl.hash = rel.hash
  return baseUrl
}

async function runUserCode<T>(
  code: string,
  context: Record<string, unknown>
): Promise<T> {
  const sandbox = vm.createContext({ ...context })
  const script = new vm.Script(`(${code})()`)
  const result = script.runInContext(sandbox)
  if (result && typeof (result as Promise<T>).then === 'function') {
    return (result as Promise<T>)
  }
  return result as T
}

export function createCodeExecutor(apiBase: string) {
  return async (code: string, apiToken: string, userId?: string | null): Promise<unknown> => {
    const datum = {
      async request<T = unknown>(options: DatumRequestOptions): Promise<DatumResponse<T>> {
        const { method, path, query, body, contentType, rawBody, organizationId, projectId } = options

        if (organizationId && projectId) {
          throw new Error('Provide only one of organizationId or projectId')
        }

        const apiHost = new URL(apiBase).host
        let base = apiBase
        if (organizationId) {
          base = `https://${apiHost}/apis/resourcemanager.miloapis.com/v1alpha1/organizations/${organizationId}/control-plane`
        } else if (projectId) {
          base = `https://${apiHost}/apis/resourcemanager.miloapis.com/v1alpha1/projects/${projectId}/control-plane`
        } else if (userId && path.startsWith('/apis/')) {
          base = `https://${apiHost}/apis/iam.miloapis.com/v1alpha1/users/${userId}/control-plane`
        }

        const url = buildUrl(base, path)
        if (query) {
          for (const [key, value] of Object.entries(query)) {
            if (value !== undefined) {
              url.searchParams.set(key, String(value))
            }
          }
        }

        const headers: Record<string, string> = {
          Authorization: `Bearer ${apiToken}`
        }

        if (contentType) {
          headers['Content-Type'] = contentType
        } else if (body && !rawBody) {
          headers['Content-Type'] = 'application/json'
        }

        let requestBody: BodyInit | undefined
        if (rawBody) {
          requestBody = body as BodyInit
        } else if (body) {
          requestBody = JSON.stringify(body)
        }

        if (config.logApiRequests) {
          const bodyText = body ? (rawBody ? String(body) : JSON.stringify(body)) : ''
          console.log(
            `[datum] -> ${method} ${url.host}${url.pathname}${url.search} headers=${JSON.stringify(headers)}${bodyText ? ` body=${bodyText}` : ''}`
          )
        }

        const response = await fetch(url.toString(), {
          method,
          headers,
          body: requestBody
        })

        const responseContentType = response.headers.get('content-type') || ''

        if (!responseContentType.includes('application/json')) {
          const text = await response.text()
          if (config.logApiResponses) {
            const headersObj: Record<string, string> = {}
            response.headers.forEach((value, key) => {
              headersObj[key] = value
            })
            console.log(
              `[datum] <- ${method} ${url.host}${url.pathname}${url.search} ${response.status} headers=${JSON.stringify(headersObj)} body=${text}`
            )
          }
          if (!response.ok) {
            throw new Error(`Datum API error: ${response.status} ${text}`)
          }
          return { status: response.status, result: text as T }
        }

        const data = (await response.json()) as T
        if (config.logApiResponses) {
          const headersObj: Record<string, string> = {}
          response.headers.forEach((value, key) => {
            headersObj[key] = value
          })
          console.log(
            `[datum] <- ${method} ${url.host}${url.pathname}${url.search} ${response.status} headers=${JSON.stringify(headersObj)} body=${JSON.stringify(data)}`
          )
        }
        if (!response.ok) {
          const message =
            (data as any)?.message || (data as any)?.error || (data as any)?.reason || JSON.stringify(data)
          throw new Error(`Datum API error: ${response.status} ${message}`)
        }

        return { status: response.status, result: data }
      }
    }

    return runUserCode(code, { datum })
  }
}

export function createSearchExecutor(specPath: string) {
  return async (code: string): Promise<unknown> => {
    const specJson = await readFile(specPath, 'utf-8')
    if (!specJson) {
      throw new Error('spec.json not found. Run the scheduled refresh or seed script.')
    }
    const spec = JSON.parse(specJson) as Record<string, unknown>
    return runUserCode(code, { spec })
  }
}
