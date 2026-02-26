import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { readFile } from 'node:fs/promises'
import { createCodeExecutor, createSearchExecutor } from './executor'
import { truncateResponse } from './truncate'

const DATUM_TYPES = `
interface DatumRequestOptions {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  contentType?: string;  // Custom Content-Type header (defaults to application/json if body is present)
  rawBody?: boolean;     // If true, sends body as-is without JSON.stringify
  organizationId?: string; // Optional org context (switches host)
  projectId?: string;      // Optional project context (switches host)
}

interface DatumResponse<T = unknown> {
  status: number;
  result: T;
}

declare const datum: {
  request<T = unknown>(options: DatumRequestOptions): Promise<DatumResponse<T>>;
};
`

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

const SPEC_TYPES = `
interface OperationInfo {
  summary?: string;
  description?: string;
  tags?: string[];
  parameters?: Array<{ name: string; in: string; required?: boolean; schema?: unknown; description?: string }>;
  requestBody?: { required?: boolean; content?: Record<string, { schema?: unknown }> };
  responses?: Record<string, { description?: string; content?: Record<string, { schema?: unknown }> }>;
}

interface PathItem {
  get?: OperationInfo;
  post?: OperationInfo;
  put?: OperationInfo;
  patch?: OperationInfo;
  delete?: OperationInfo;
}

declare const spec: {
  paths: Record<string, PathItem>;
};
`

export async function createServer(
  apiToken: string,
  apiBase: string,
  specPath: string,
  productsPath: string,
  userId?: string | null
): Promise<McpServer> {
  const server = new McpServer({
    name: 'datum-api',
    version: '0.1.0'
  })

  const executeCode = createCodeExecutor(apiBase)
  const executeSearch = createSearchExecutor(specPath)

  const productsJson = await readFile(productsPath, 'utf-8').catch(() => '')
  const products: string[] = productsJson ? JSON.parse(productsJson) : []

  server.registerTool(
    'search',
    {
      description: `Search the Datum OpenAPI spec. All $refs are pre-resolved inline.

Products: ${products.slice(0, 30).join(', ')}... (${products.length} total)

Types:
${SPEC_TYPES}

Examples:

// Find endpoints by product/group tag
async () => {
  const results = [];
  for (const [path, methods] of Object.entries(spec.paths)) {
    for (const [method, op] of Object.entries(methods)) {
      if (op.tags?.some(t => t.toLowerCase() === 'iam')) {
        results.push({ method: method.toUpperCase(), path, summary: op.summary });
      }
    }
  }
  return results;
}

// Get endpoint with requestBody schema (refs are resolved)
async () => {
  const op = spec.paths['/apis/iam.miloapis.com/v1alpha1/users']?.post;
  return { summary: op?.summary, requestBody: op?.requestBody };
}

// Get endpoint parameters
async () => {
  const op = spec.paths['/apis/compute.miloapis.com/v1alpha1/projects']?.get;
  return op?.parameters;
}`,
      inputSchema: {
        code: z.string().describe('JavaScript async arrow function to search the OpenAPI spec')
      }
    },
    async ({ code }) => {
      try {
        const result = await executeSearch(code)
        return { content: [{ type: 'text', text: truncateResponse(result) }] }
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error: ${formatError(error)}` }],
          isError: true
        }
      }
    }
  )

  const executeDescription = `Execute JavaScript code against the Datum API. First use the 'search' tool to find the right endpoints, then write code using the datum.request() function.

Available in your code:
${DATUM_TYPES}

Your code must be an async arrow function that returns the result.

Example: list projects
async () => {
  return datum.request({ method: "GET", path: "/apis/compute.miloapis.com/v1alpha1/projects" });
}`

  server.registerTool(
    'execute',
    {
      description: executeDescription,
      inputSchema: {
        code: z.string().describe('JavaScript async arrow function to execute')
      }
    },
    async ({ code }) => {
      try {
        const result = await executeCode(code, apiToken, userId)
        return { content: [{ type: 'text', text: truncateResponse(result) }] }
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error: ${formatError(error)}` }],
          isError: true
        }
      }
    }
  )

  return server
}
