export interface OpenApiResourceInfo {
  path: string
  serverRelativeURL: string
}

function withAuthHeaders(token?: string): HeadersInit {
  if (!token) return { Accept: 'application/json' }
  return { Authorization: `Bearer ${token}`, Accept: 'application/json' }
}

export async function fetchOpenApiIndex(
  apiBase: string,
  indexPath: string,
  token?: string
): Promise<Record<string, unknown>> {
  const url = new URL(indexPath, apiBase).toString()
  const response = await fetch(url, { headers: withAuthHeaders(token) })
  if (!response.ok) {
    throw new Error(`Failed to fetch OpenAPI index: ${response.status} ${response.statusText}`)
  }
  return (await response.json()) as Record<string, unknown>
}

/**
 * Extract OpenAPI resources from the index document.
 */
export function extractOpenApiResources(indexSpec: Record<string, unknown>): OpenApiResourceInfo[] {
  const resources: OpenApiResourceInfo[] = []
  const paths = indexSpec.paths as Record<string, unknown> | undefined
  if (!paths) return resources

  for (const [path, value] of Object.entries(paths)) {
    if (!value || typeof value !== 'object') continue
    const pathObj = value as Record<string, unknown>
    const serverRelativeURL = pathObj.serverRelativeURL
    if (typeof serverRelativeURL !== 'string') continue

    const normalized = path.startsWith('/') ? path.slice(1) : path
    if (normalized.startsWith('apis/')) {
      resources.push({ path: normalized, serverRelativeURL })
    }
  }

  return resources.sort((a, b) => a.path.localeCompare(b.path))
}

export function filterResources(
  resources: OpenApiResourceInfo[],
  allowed?: string[]
): OpenApiResourceInfo[] {
  if (!allowed || allowed.length === 0) return resources
  const allow = new Set(allowed.map((p) => p.trim()).filter(Boolean))
  return resources.filter((r) => allow.has(r.path))
}

export async function fetchOpenApiSpec(
  apiBase: string,
  token: string | undefined,
  serverRelativeURL: string
): Promise<Record<string, unknown>> {
  const url = new URL(serverRelativeURL, apiBase).toString()
  const response = await fetch(url, { headers: withAuthHeaders(token) })
  if (!response.ok) {
    throw new Error(`Failed to fetch OpenAPI spec: ${response.status} ${response.statusText}`)
  }
  return (await response.json()) as Record<string, unknown>
}
