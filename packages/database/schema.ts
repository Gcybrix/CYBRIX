/**
 * CYBRIX — D1 Database Schema (v1)
 * Applied by the in-worker migration runner (idempotent).
 * Each app (central-bot / standalone-bot / builder-bot) runs the subset it needs:
 *   SCHEMA_CORE  : users, orgs, channels, challenges, participants, wallets, tx, audit...
 *   SCHEMA_QUIZ  : quiz_questions, quiz_answers
 *   SCHEMA_BUILDER: builder users, installations
 */
export const SCHEMA_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,

  `CREATE TABLE IF NOT EXISTS users (
    telegram_id INTEGER PRIMARY KEY,
    first_name TEXT DEFAULT '',
    username TEXT DEFAULT '',
    lang TEXT NOT NULL DEFAULT 'fa',
    role TEXT NOT NULL DEFAULT 'user',
    status TEXT NOT NULL DEFAULT 'active',
    blocked_until INTEGER,
    block_reason TEXT,
    risk_score INTEGER NOT NULL DEFAULT 0,
    joined_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_users_last_seen ON users(last_seen_at)`,

  `CREATE TABLE IF NOT EXISTS organizations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    owner_tid INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS org_members (
    org_id INTEGER NOT NULL,
    telegram_id INTEGER NOT NULL,
    role TEXT NOT NULL DEFAULT 'admin',
    added_at INTEGER NOT NULL,
    PRIMARY KEY (org_id, telegram_id)
  )`,

  `CREATE TABLE IF NOT EXISTS channels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id INTEGER,
    chat_id TEXT NOT NULL UNIQUE,
    title TEXT DEFAULT '',
    username TEXT DEFAULT '',
    owner_tid INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    added_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_channels_owner ON channels(owner_tid)`,

  `CREATE TABLE IF NOT EXISTS challenges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id INTEGER,
    channel_chat_id TEXT NOT NULL,
    created_by INTEGER NOT NULL,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'draft',
    start_at INTEGER,
    end_at INTEGER NOT NULL,
    tz TEXT NOT NULL DEFAULT 'Asia/Tehran',
    winners_count INTEGER NOT NULL DEFAULT 1,
    prizes TEXT DEFAULT '',
    rules TEXT DEFAULT '',
    rules_version TEXT NOT NULL DEFAULT '1',
    config TEXT DEFAULT '{}',
    commit_hash TEXT,
    commit_salt TEXT,
    snapshot_hash TEXT,
    cost INTEGER NOT NULL DEFAULT 0,
    message_id INTEGER,
    reminded INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_challenges_status_end ON challenges(status, end_at)`,
  `CREATE INDEX IF NOT EXISTS idx_challenges_channel ON challenges(channel_chat_id)`,

  `CREATE TABLE IF NOT EXISTS participants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    challenge_id INTEGER NOT NULL,
    telegram_id INTEGER NOT NULL,
    joined_at INTEGER NOT NULL,
    score INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active',
    UNIQUE (challenge_id, telegram_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_participants_ch ON participants(challenge_id, score)`,

  `CREATE TABLE IF NOT EXISTS referrals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    challenge_id INTEGER NOT NULL,
    inviter_tid INTEGER NOT NULL,
    invitee_tid INTEGER NOT NULL UNIQUE,
    valid INTEGER NOT NULL DEFAULT 0,
    reason TEXT DEFAULT '',
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_referrals_ch_inviter ON referrals(challenge_id, inviter_tid)`,

  `CREATE TABLE IF NOT EXISTS votes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    challenge_id INTEGER NOT NULL,
    voter_tid INTEGER NOT NULL,
    target_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL,
    changed_at INTEGER,
    UNIQUE (challenge_id, voter_tid)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_votes_ch_target ON votes(challenge_id, target_id)`,

  `CREATE TABLE IF NOT EXISTS quiz_questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    challenge_id INTEGER NOT NULL,
    idx INTEGER NOT NULL,
    text TEXT NOT NULL,
    options TEXT NOT NULL,
    correct_idx INTEGER NOT NULL,
    time_sec INTEGER NOT NULL DEFAULT 60,
    UNIQUE (challenge_id, idx)
  )`,
  `CREATE TABLE IF NOT EXISTS quiz_answers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    question_id INTEGER NOT NULL,
    telegram_id INTEGER NOT NULL,
    option_idx INTEGER,
    correct INTEGER NOT NULL DEFAULT 0,
    answered_at INTEGER NOT NULL,
    UNIQUE (question_id, telegram_id)
  )`,

  `CREATE TABLE IF NOT EXISTS prizes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    challenge_id INTEGER NOT NULL,
    rank INTEGER NOT NULL,
    title TEXT DEFAULT '',
    value TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending',
    UNIQUE (challenge_id, rank)
  )`,
  `CREATE TABLE IF NOT EXISTS winners (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    challenge_id INTEGER NOT NULL,
    telegram_id INTEGER NOT NULL,
    rank INTEGER NOT NULL,
    selected_at INTEGER NOT NULL,
    method TEXT NOT NULL DEFAULT '',
    proof TEXT DEFAULT '',
    replaced_by INTEGER,
    UNIQUE (challenge_id, rank)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_winners_ch ON winners(challenge_id)`,

  `CREATE TABLE IF NOT EXISTS wallets (
    telegram_id INTEGER PRIMARY KEY,
    free INTEGER NOT NULL DEFAULT 0,
    purchased INTEGER NOT NULL DEFAULT 0,
    gift INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS credit_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    txid TEXT NOT NULL UNIQUE,
    telegram_id INTEGER NOT NULL,
    kind TEXT NOT NULL,
    wallet_kind TEXT NOT NULL,
    amount INTEGER NOT NULL,
    balance_after INTEGER NOT NULL,
    ref TEXT DEFAULT '',
    reason TEXT DEFAULT '',
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_tx_user ON credit_transactions(telegram_id, created_at)`,

  `CREATE TABLE IF NOT EXISTS payment_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id INTEGER NOT NULL,
    provider TEXT NOT NULL DEFAULT 'manual',
    amount INTEGER NOT NULL,
    credits INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    payload TEXT DEFAULT '',
    created_at INTEGER NOT NULL,
    paid_at INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id INTEGER NOT NULL,
    plan TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    starts_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS coupons (
    code TEXT PRIMARY KEY,
    kind TEXT NOT NULL DEFAULT 'credits',
    amount INTEGER NOT NULL,
    max_uses INTEGER NOT NULL DEFAULT 1,
    uses INTEGER NOT NULL DEFAULT 0,
    expires_at INTEGER,
    created_by INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id INTEGER,
    kind TEXT NOT NULL,
    text TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    sent_at INTEGER,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS support_tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id INTEGER NOT NULL,
    subject TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS ticket_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id INTEGER NOT NULL,
    sender_tid INTEGER NOT NULL,
    from_role TEXT NOT NULL DEFAULT 'user',
    text TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS abuse_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reporter_tid INTEGER NOT NULL,
    target_type TEXT NOT NULL,
    target_id TEXT NOT NULL,
    reason TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'open',
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS audit_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_tid INTEGER,
    action TEXT NOT NULL,
    target_type TEXT DEFAULT '',
    target_id TEXT DEFAULT '',
    meta TEXT DEFAULT '',
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_audit_target ON audit_events(target_type, target_id)`,

  `CREATE TABLE IF NOT EXISTS webhook_events (
    update_id INTEGER PRIMARY KEY,
    processed_at INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'ok'
  )`,
  `CREATE TABLE IF NOT EXISTS scheduled_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    payload TEXT DEFAULT '',
    run_at INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE INDEX IF NOT EXISTS idx_jobs_due ON scheduled_jobs(status, run_at)`,

  `CREATE TABLE IF NOT EXISTS coupon_redemptions (
    code TEXT NOT NULL,
    telegram_id INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (code, telegram_id)
  )`,

  `CREATE TABLE IF NOT EXISTS prize_deliveries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    challenge_id INTEGER NOT NULL,
    rank INTEGER NOT NULL,
    winner_tid INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    deadline_at INTEGER NOT NULL,
    responded_at INTEGER,
    delivered_at INTEGER,
    note TEXT DEFAULT '',
    UNIQUE (challenge_id, rank)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_pd_status ON prize_deliveries(status, deadline_at)`,

  `CREATE TABLE IF NOT EXISTS photo_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    challenge_id INTEGER NOT NULL,
    telegram_id INTEGER NOT NULL,
    file_id TEXT NOT NULL,
    caption TEXT DEFAULT '',
    created_at INTEGER NOT NULL,
    UNIQUE (challenge_id, telegram_id)
  )`,

  `CREATE TABLE IF NOT EXISTS challenge_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_tid INTEGER NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    data TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS panel_sessions (
    token TEXT PRIMARY KEY,
    telegram_id INTEGER NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS panel_login_codes (
    code TEXT PRIMARY KEY,
    telegram_id INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    used INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS wizard_state (
    telegram_id INTEGER PRIMARY KEY,
    step TEXT NOT NULL,
    data TEXT NOT NULL DEFAULT '{}',
    updated_at INTEGER NOT NULL
  )`
];

/** Prize delivery row shape. */
export interface PrizeDeliveryRow {
  id: number;
  challenge_id: number;
  rank: number;
  winner_tid: number;
  status: 'pending' | 'claimed' | 'delivered' | 'expired' | 'replaced';
  deadline_at: number;
  responded_at: number | null;
  delivered_at: number | null;
  note: string;
}

export const BUILDER_SCHEMA_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS builder_users (
    telegram_id INTEGER PRIMARY KEY,
    first_name TEXT DEFAULT '',
    username TEXT DEFAULT '',
    lang TEXT NOT NULL DEFAULT 'fa',
    joined_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS wizard_state (
    telegram_id INTEGER PRIMARY KEY,
    step TEXT NOT NULL,
    data TEXT NOT NULL DEFAULT '{}',
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS bot_installations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_tid INTEGER NOT NULL,
    bot_username TEXT NOT NULL,
    account_id TEXT NOT NULL,
    worker_name TEXT NOT NULL,
    panel_name TEXT NOT NULL DEFAULT '',
    db_name TEXT NOT NULL,
    subdomain TEXT NOT NULL DEFAULT '',
    version TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'installed',
    webhook_url TEXT DEFAULT '',
    installed_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS audit_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_tid INTEGER,
    action TEXT NOT NULL,
    target_type TEXT DEFAULT '',
    target_id TEXT DEFAULT '',
    meta TEXT DEFAULT '',
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS webhook_events (
    update_id INTEGER PRIMARY KEY,
    processed_at INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'ok'
  )`
];

export const SCHEMA_VERSION = 'v2';
