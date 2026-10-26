/** Credit wallet — auditable ledger with atomic spend & refund (D1 batch). */
import type { Env } from './types';
import { now, audit } from './db';

export interface Wallet {
  free: number;
  purchased: number;
  gift: number;
}

export async function getWallet(env: Env, tid: number): Promise<Wallet> {
  const r = await env.DB.prepare(`SELECT free, purchased, gift FROM wallets WHERE telegram_id=?`).bind(tid).first<Wallet>();
  return r ?? { free: 0, purchased: 0, gift: 0 };
}

export const total = (w: Wallet) => w.free + w.purchased + w.gift;

/** Spend `amount` credits. Order: free → gift → purchased (documented policy). Atomic via guarded UPDATE. */
export async function spend(env: Env, tid: number, amount: number, reason: string, ref: string): Promise<boolean> {
  const w = await getWallet(env, tid);
  if (total(w) < amount) return false;

  let freeCut = Math.min(w.free, amount);
  let giftCut = Math.min(w.gift, amount - freeCut);
  let purchCut = amount - freeCut - giftCut;

  const txid = crypto.randomUUID();
  const ts = now();
  const stmts = [
    env.DB.prepare(
      `UPDATE wallets SET
         free = free - ?, gift = gift - ?, purchased = purchased - ?, updated_at = ?
       WHERE telegram_id = ? AND (free + gift + purchased) >= ?`
    ).bind(freeCut, giftCut, purchCut, ts, tid, amount),
    env.DB.prepare(
      `INSERT INTO credit_transactions (txid, telegram_id, kind, wallet_kind, amount, balance_after, ref, reason, created_at)
       VALUES (?,?,?,?,?,?,?,?,?)`
    ).bind(txid, tid, 'spend', 'free', amount, total(w) - amount, ref, reason, ts),
  ];
  const res = await env.DB.batch(stmts);
  const ok = res[0]?.success === true && (res[0]?.meta?.changes ?? 0) === 1;
  if (ok) await audit(env.DB, tid, 'credit.spend', 'wallet', tid, `${amount}:${reason}`);
  return ok;
}

export async function grant(env: Env, tid: number, amount: number, kind: 'free' | 'gift' | 'purchased', reason: string): Promise<boolean> {
  if (amount <= 0) return false;
  const ts = now();
  const col = kind;
  const before = await getWallet(env, tid);
  const after = total(before) + amount;
  const txid = crypto.randomUUID();
  const res = await env.DB.batch([
    env.DB.prepare(`INSERT INTO wallets (telegram_id, free, purchased, gift, updated_at) VALUES (?,?,?,?,?)
                    ON CONFLICT(telegram_id) DO NOTHING`).bind(tid, kind === 'free' ? amount : 0, kind === 'purchased' ? amount : 0, kind === 'gift' ? amount : 0, ts),
    env.DB.prepare(
      `UPDATE wallets SET ${col} = ${col} + ?, updated_at = ? WHERE telegram_id = ?`
    ).bind(amount, ts, tid),
    env.DB.prepare(
      `INSERT INTO credit_transactions (txid, telegram_id, kind, wallet_kind, amount, balance_after, ref, reason, created_at)
       VALUES (?,?,?,?,?,?,?,?,?)`
    ).bind(txid, tid, 'grant', kind, amount, after, '', reason, ts),
  ]);
  return res[1]?.success === true;
}

/** Refund a failed/eligible operation (audited, idempotent via ref+reason lookup by caller). */
export async function refund(env: Env, tid: number, amount: number, kind: 'free' | 'gift' | 'purchased', ref: string): Promise<boolean> {
  const dup = await env.DB
    .prepare(`SELECT id FROM credit_transactions WHERE telegram_id=? AND kind='refund' AND ref=? LIMIT 1`)
    .bind(tid, ref)
    .first();
  if (dup) return true; // already refunded
  const ts = now();
  const before = await getWallet(env, tid);
  const after = total(before) + amount;
  const txid = crypto.randomUUID();
  const res = await env.DB.batch([
    env.DB.prepare(`UPDATE wallets SET ${kind} = ${kind} + ?, updated_at=? WHERE telegram_id=?`).bind(amount, ts, tid),
    env.DB.prepare(
      `INSERT INTO credit_transactions (txid, telegram_id, kind, wallet_kind, amount, balance_after, ref, reason, created_at)
       VALUES (?,?,?,?,?,?,?,?,?)`
    ).bind(txid, tid, 'refund', kind, amount, after, ref, 'operation refund', ts),
  ]);
  return res[0]?.success === true;
}

export async function txHistory(env: Env, tid: number, limit = 10) {
  return env.DB
    .prepare(`SELECT kind, wallet_kind, amount, balance_after, reason, created_at FROM credit_transactions
              WHERE telegram_id=? ORDER BY id DESC LIMIT ?`)
    .bind(tid, limit)
    .all<{ kind: string; wallet_kind: string; amount: number; balance_after: number; reason: string; created_at: number }>();
}

/** Redeem a gift/coupon code — per-user single redemption + atomic uses guard. */
export async function redeemCode(env: Env, tid: number, code: string): Promise<number | 'dup' | null> {
  const ts = now();
  const c = await env.DB
    .prepare(`SELECT code, amount, max_uses, uses, expires_at FROM coupons WHERE upper(code)=?`)
    .bind(code.toUpperCase())
    .first<{ code: string; amount: number; max_uses: number; uses: number; expires_at: number | null }>();
  if (!c) return null;
  if (c.uses >= c.max_uses || (c.expires_at && c.expires_at < ts)) return null;

  // 1) claim the user's single redemption slot first
  const ins = await env.DB
    .prepare(`INSERT INTO coupon_redemptions (code, telegram_id, created_at) VALUES (?,?,?) ON CONFLICT DO NOTHING`)
    .bind(c.code, tid, ts)
    .run();
  if ((ins.meta?.changes ?? 0) !== 1) return 'dup'; // this user already redeemed it

  // 2) consume one global use, guarded; roll back the slot if exhausted
  const upd = await env.DB.prepare(`UPDATE coupons SET uses = uses + 1 WHERE code=? AND uses < max_uses`).bind(c.code).run();
  if ((upd.meta?.changes ?? 0) !== 1) {
    await env.DB.prepare(`DELETE FROM coupon_redemptions WHERE code=? AND telegram_id=?`).bind(c.code, tid).run();
    return null;
  }

  await grant(env, tid, c.amount, 'gift', `coupon:${c.code}`);
  await audit(env.DB, tid, 'coupon.redeem', 'coupon', c.code, `${c.amount}`);
  return c.amount;
}
