# datum-code-mode-mcp

MCP server for the Datum API using a Code Mode approach (two tools: `search` and `execute`).

## Local development

- Start the server with `npm run dev`.
- Authenticate via `/auth/login` to obtain a session cookie.
- Run  `DATUM_OPENAPI_TOKEN=... npx tsx scripts/seed-local.ts`, you can take access token from `data/sessions.json`

### Environment variables

Defaults target production based on datumctl/cloud-portal settings:
- `DATUM_API_BASE` defaults to `https://api.datum.net`
- `AUTH_OIDC_ISSUER` defaults to `https://auth.datum.net`
- `AUTH_OIDC_CLIENT_ID` derives from the issuer hostname:
  - `*.staging.env.datum.net` → `325848904128073754`
  - `*.datum.net` → `328728232771788043`

Required for scheduled spec refresh (otherwise refresh is skipped):
- `DATUM_OPENAPI_TOKEN`: bearer token used to fetch the OpenAPI specs

Note: after OAuth login, the server will also attempt to refresh the spec using the session access token if `spec.json` is missing.

Optional for OAuth:
- `AUTH_OIDC_ISSUER`: OIDC issuer (Zitadel)
- `AUTH_OIDC_CLIENT_ID`: client id
- `AUTH_OIDC_CLIENT_SECRET`: client secret (if required by the provider)

Optional:
- `DATUM_API_BASE` (default `https://api.datum.net`)
- `DATUM_OPENAPI_INDEX_PATH` (default `/openapi/v3`)
- `DATUM_OPENAPI_RESOURCES` (comma-separated list of OpenAPI resource paths)
- `DATUM_OPENAPI_MAX_RESOURCES` (cap on number of resources fetched)
- `DATUM_DATA_DIR` (default `./data`)
- `DATUM_SPEC_PATH` (default `./data/spec.json`)
- `DATUM_PRODUCTS_PATH` (default `./data/products.json`)
- `DATUM_TOKEN_STORE_PATH` (default `./data/sessions.json`)
- `AUTH_OIDC_REDIRECT_URI` (defaults to `${BASE_URL}/auth/callback`)
- `BASE_URL` (default `http://localhost:8787`)
- `PORT` (default `8787`)
- `MCP_LOG_REQUESTS` (`1` to enable request logging)
- `MCP_LOG_BODIES` (`1` to log request bodies, capped at 2k chars)
- `MCP_LOG_API_REQUESTS` (`1` to log Datum API requests, including headers and full body)
- `MCP_LOG_API_RESPONSES` (`1` to log Datum API responses, including headers and full body)
- `MCP_CLI_TOKEN_TTL_MS` (default `600000` = 10 minutes)
 
Storage:
- Tokens and spec are stored on disk under `DATUM_DATA_DIR`.

### Seed spec locally

```bash
DATUM_OPENAPI_TOKEN=... npx tsx scripts/seed-local.ts
```

## Tools

- `search`: executes JavaScript against a pre-processed OpenAPI spec (`spec` global)
- `execute`: executes JavaScript against the Datum API (`datum.request` global)

`datum.request` accepts optional `organizationId` or `projectId` to switch the API host to the control-plane URL for that context (per datumctl behavior). If neither is provided and the request path starts with `/apis/`, the server will automatically prefix the user control-plane base using the authenticated user ID.

## CLI authentication

1) Log in via `http://localhost:8787/auth/login`
2) Fetch a short-lived bearer token from `http://localhost:8787/auth/token`
3) Use it with your MCP client as `Authorization: Bearer <token>`
