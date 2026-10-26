/** CYBRIX shared configuration & brand (no secrets here). */
export const BRAND = {
  name: 'CYBRIX',
  slogan: 'Code. Security. Innovation.',
  version: '1.0.0',
};

/** Official mandatory channels — enforced by CYBRIX policy on the central platform. */
export const OFFICIAL_CHANNELS = [
  '@cybrix_official',
  '@cybrixdev',
  '@cybrix_network',
  '@cybrix_hub',
  '@cybrix_store',
] as const;

export const CREDIT_COSTS: Record<string, number> = {
  random: 1,
  vote: 2,
  referral: 2,
  quiz: 3,
};

export const CREDIT_LABELS: Record<string, { fa: string; en: string }> = {
  random: { fa: '🎲 قرعه‌کشی تصادفی', en: '🎲 Random Lottery' },
  vote: { fa: '🗳 رأی‌گیری / لایک', en: '🗳 Voting / Likes' },
  referral: { fa: '👥 رقابت دعوت', en: '👥 Referral Contest' },
  quiz: { fa: '🧠 آزمون و مسابقه سؤالی', en: '🧠 Quiz Contest' },
};

export const SIGNUP_FREE_CREDITS = 10;

export type ChallengeType = 'random' | 'vote' | 'referral' | 'quiz';

export interface ChallengeConfig {
  change_vote: boolean;
  public_counts: boolean;
  reward_credits: number;
  extra_channels: string[];
}

export const DEFAULT_CONFIG: ChallengeConfig = {
  change_vote: true,
  public_counts: true,
  reward_credits: 0,
  extra_channels: [],
};

export function parseJson<T>(raw: string | undefined | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** Parse "YYYY-MM-DD HH:MM" (Asia/Tehran, UTC+3:30) to epoch seconds. Returns null if invalid. */
export function parseTehranDateTime(input: string): number | null {
  const m = input.trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m.map(Number) as unknown as number[];
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  // Tehran fixed offset +03:30 (Iran abolished DST in 2022)
  const ms = Date.UTC(y, mo - 1, d, h, mi) - 3.5 * 3600 * 1000;
  return Math.floor(ms / 1000);
}

export function fmtTehranDateTime(epochSec: number): string {
  const d = new Date((epochSec + 3.5 * 3600) * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

/** Random hex string using crypto.getRandomValues (Workers-compatible). */
export function randHex(bytes: number): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return [...arr].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function sha256Hex(s: string): Promise<string> {
  const data = new TextEncoder().encode(s);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
