/** Core unit tests — winner ranking algorithm (replicates production logic). */
import { describe, it, expect } from 'bun:test';

async function sha256Hex(s: string): Promise<string> {
  const data = new TextEncoder().encode(s);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Production ranking: ascending hash(salt:tid) — deterministic & auditable. */
async function rankWinners(salt: string, tids: number[], k: number): Promise<number[]> {
  const ranked = await Promise.all(tids.map(async (tid) => ({ tid, key: await sha256Hex(`${salt}:${tid}`) })));
  ranked.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return ranked.slice(0, k).map((r) => r.tid);
}

describe('commit-reveal winner selection', () => {
  it('is deterministic for the same salt + list', async () => {
    const tids = [111, 222, 333, 444, 555, 666];
    const a = await rankWinners('abc123', tids, 2);
    const b = await rankWinners('abc123', tids, 2);
    expect(a).toEqual(b);
  });

  it('changes with a different salt', async () => {
    const tids = [111, 222, 333, 444, 555, 666];
    const a = await rankWinners('salt-a', tids, 3);
    const b = await rankWinners('salt-b', tids, 3);
    expect(a.join()).not.toBe(b.join());
  });

  it('returns exactly k winners, no duplicates, all from pool', async () => {
    const tids = Array.from({ length: 50 }, (_, i) => 9000 + i);
    const winners = await rankWinners('s', tids, 5);
    expect(winners.length).toBe(5);
    expect(new Set(winners).size).toBe(5);
    for (const w of winners) expect(tids).toContain(w);
  });

  it('handles k >= pool size', async () => {
    const winners = await rankWinners('s', [1, 2], 10);
    expect(winners.length).toBe(2);
  });
});
