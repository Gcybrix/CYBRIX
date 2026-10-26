/** i18n & config tests. */
import { describe, it, expect } from 'bun:test';
import { STRINGS, t } from '../shared/src/i18n';
import { parseTehranDateTime, fmtTehranDateTime, CREDIT_COSTS, randHex, sha256Hex } from '../shared/src/config';

describe('i18n', () => {
  it('fa and en dictionaries have identical key sets', () => {
    const fa = Object.keys(STRINGS.fa).sort();
    const en = Object.keys(STRINGS.en).sort();
    expect(en).toEqual(fa);
  });

  it('interpolates parameters', () => {
    expect(t('fa', 'grant_done', { amount: 5, user: 'Ali' })).toContain('5');
    expect(t('en', 'redeem_ok', { amount: 7 })).toContain('7');
  });

  it('falls back to fa then key', () => {
    expect(t('en', '__missing__')).toBe('__missing__');
  });
});

describe('Tehran datetime', () => {
  it('parses 2025-08-30 18:00 as epoch 14:30 UTC', () => {
    const ep = parseTehranDateTime('2025-08-30 18:00');
    expect(ep).toBe(Date.UTC(2025, 7, 30, 14, 30) / 1000);
  });

  it('rejects malformed input (past dates are allowed — freshness checked by caller)', () => {
    expect(parseTehranDateTime('1999-01-01 10:00')).not.toBeNull();
    expect(parseTehranDateTime('garbage')).toBeNull();
    expect(parseTehranDateTime('2025-13-40 99:00')).toBeNull();
  });

  it('formats round-trip', () => {
    const ep = parseTehranDateTime('2025-08-30 18:00')!;
    expect(fmtTehranDateTime(ep)).toBe('2025-08-30 18:00');
  });
});

describe('credits & crypto utils', () => {
  it('every challenge type has a cost', () => {
    for (const tp of ['random', 'vote', 'referral', 'quiz']) expect(CREDIT_COSTS[tp]).toBeGreaterThan(0);
  });

  it('randHex produces requested length', () => {
    expect(randHex(16).length).toBe(32);
    expect(randHex(4).length).toBe(8);
  });

  it('sha256 is stable', async () => {
    expect(await sha256Hex('cybrix')).toBe(await sha256Hex('cybrix'));
  });
});
