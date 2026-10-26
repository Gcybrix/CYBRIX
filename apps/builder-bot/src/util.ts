/** Small shared utilities (HTML escaping, token masking, name sanitizing, sleep). */

export const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Never log or echo full tokens — mask as first 6 chars + ***. */
export function maskToken(tok: string): string {
  if (!tok) return '***';
  return tok.length > 6 ? `${tok.slice(0, 6)}***` : '***';
}

export const sleep = (ms: number): Promise<void> => new Promise<void>((r) => setTimeout(r, ms));

/** Sanitize to [a-z0-9-], collapse repeats, trim dashes, max 30 chars. null if nothing left. */
export function sanitizeNameX(input: string): string | null {
  const x = (input || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30)
    .replace(/-+$/g, '');
  return x || null;
}

/** Resource base derived from the bot username: `cybrix-<x>`. */
export function proposeBase(username: string): string {
  const x = sanitizeNameX(username) ?? 'bot';
  return `cybrix-${x}`;
}

/** Custom base typed by the user — sanitized, always cybrix-prefixed, ≤38 chars. */
export function customBase(input: string): string | null {
  const x = sanitizeNameX(input);
  if (!x) return null;
  if (x.startsWith('cybrix-')) return x.slice(0, 38).replace(/-+$/g, '');
  return `cybrix-${x}`;
}

export const workerUrlFor = (workerName: string, subdomain: string): string =>
  `https://${workerName}.${subdomain}.workers.dev`;

/** Short single-line error for chat messages (code + message, ≤180 chars). */
export function shortErr(code: number | string | undefined, message: string | undefined): string {
  const m = (message || 'unknown error').replace(/\s+/g, ' ').trim().slice(0, 150);
  return code !== undefined && code !== null && `${code}` !== '' ? `(${code}) ${m}` : m;
}
