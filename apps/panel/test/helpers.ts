/** Test helpers exposing internal pure functions for unit tests. */
export function decodeSyncCursorTestHook(token: string): unknown {
  // mirror of routes/relays.ts decodeSyncCursor (kept in sync via test)
  let parsed: unknown
  try {
    const b64 = token.replace(/-/g, '+').replace(/_/g, '/')
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
    const bin = atob(padded)
    parsed = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))))
  } catch {
    throw new Error('since cursor is corrupt')
  }
  const c = parsed as { v?: number; p?: unknown } | null
  if (!c || typeof c !== 'object' || c.v !== 1 || !c.p) throw new Error('since cursor is corrupt')
  return parsed
}
