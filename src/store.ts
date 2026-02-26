import { readFile, writeFile } from 'node:fs/promises'
import { ensureDataDir } from './runtime'

export type SessionTokens = {
  accessToken?: string
  refreshToken?: string | null
  expiresAt?: number | null
  idToken?: string | null
  userId?: string | null
  updatedAt: number
}

type StoreData = {
  sessions: Record<string, SessionTokens>
  cliTokens: Record<string, { sessionId: string; expiresAt: number }>
}

let writeQueue: Promise<void> = Promise.resolve()

async function loadStore(path: string): Promise<StoreData> {
  try {
    const raw = await readFile(path, 'utf-8')
    const parsed = JSON.parse(raw) as StoreData
    return {
      sessions: parsed.sessions || {},
      cliTokens: parsed.cliTokens || {}
    }
  } catch {
    return { sessions: {}, cliTokens: {} }
  }
}

async function saveStore(path: string, data: StoreData): Promise<void> {
  await ensureDataDir()
  const payload = JSON.stringify(data, null, 2)

  writeQueue = writeQueue.then(async () => {
    await writeFile(path, payload)
  })

  await writeQueue
}

export async function getSession(id: string, path: string): Promise<SessionTokens | null> {
  const store = await loadStore(path)
  return store.sessions[id] || null
}

export async function setSession(
  id: string,
  tokens: SessionTokens,
  path: string
): Promise<void> {
  const store = await loadStore(path)
  store.sessions[id] = { ...tokens, updatedAt: Date.now() }
  await saveStore(path, store)
}

export async function updateSession(
  id: string,
  tokens: SessionTokens,
  path: string
): Promise<void> {
  const store = await loadStore(path)
  store.sessions[id] = tokens
  await saveStore(path, store)
}

export async function deleteSession(id: string, path: string): Promise<void> {
  const store = await loadStore(path)
  delete store.sessions[id]
  for (const [token, entry] of Object.entries(store.cliTokens)) {
    if (entry.sessionId === id) {
      delete store.cliTokens[token]
    }
  }
  await saveStore(path, store)
}

export async function createCliToken(
  sessionId: string,
  ttlMs: number,
  path: string
): Promise<{ token: string; expiresAt: number }> {
  const store = await loadStore(path)
  const token = crypto.randomUUID()
  const expiresAt = Date.now() + ttlMs
  store.cliTokens[token] = { sessionId, expiresAt }
  await saveStore(path, store)
  return { token, expiresAt }
}

export async function getSessionIdForCliToken(
  token: string,
  path: string
): Promise<string | null> {
  const store = await loadStore(path)
  const entry = store.cliTokens[token]
  if (!entry) return null
  if (entry.expiresAt <= Date.now()) {
    delete store.cliTokens[token]
    await saveStore(path, store)
    return null
  }
  return entry.sessionId
}
