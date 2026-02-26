import { writeFile } from 'node:fs/promises'
import { processSpec, extractProductsFromPaths } from '../src/spec-processor'
import {
  fetchOpenApiIndex,
  extractOpenApiResources,
  filterResources,
  fetchOpenApiSpec
} from '../src/openapi'
import { config, ensureDataDir, getProductsPath, getSpecPath } from '../src/runtime'

if (!config.openapiToken) {
  console.error('DATUM_OPENAPI_TOKEN is required')
  process.exit(1)
}

await ensureDataDir()

console.log(`Fetching OpenAPI index from ${new URL(config.openapiIndexPath, config.apiBase)}...`)
const indexSpec = await fetchOpenApiIndex(
  config.apiBase,
  config.openapiIndexPath,
  config.openapiToken
)
const resources = extractOpenApiResources(indexSpec)

let selected = filterResources(resources, config.openapiResources)
if (Number.isFinite(config.openapiMaxResources) && config.openapiMaxResources > 0) {
  selected = selected.slice(0, config.openapiMaxResources)
}

if (selected.length === 0) {
  console.error('No OpenAPI resources selected. Check DATUM_OPENAPI_RESOURCES.')
  process.exit(1)
}

console.log(`Fetching ${selected.length} OpenAPI resources...`)
const combinedPaths: Record<string, Record<string, unknown>> = {}

for (const resource of selected) {
  const rawSpec = await fetchOpenApiSpec(config.apiBase, config.openapiToken, resource.serverRelativeURL)
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

console.log(`Wrote spec to ${getSpecPath()} and products to ${getProductsPath()}`)
