CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    password_hash TEXT NOT NULL DEFAULT '',
    full_name TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL DEFAULT 'operator',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    locale TEXT NOT NULL DEFAULT 'en',
    timezone TEXT NOT NULL DEFAULT 'UTC',
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_email_key;
ALTER TABLE users DROP CONSTRAINT IF EXISTS uni_users_email;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email
ON users (email);

CREATE TABLE IF NOT EXISTS odds_pairs (
    id TEXT PRIMARY KEY,
    bookmaker_id TEXT NOT NULL,
    lobby_id TEXT NOT NULL,
    fixture_id TEXT NOT NULL,
    fixture_marker TEXT NOT NULL DEFAULT '',
    home_team TEXT NOT NULL DEFAULT '',
    away_team TEXT NOT NULL DEFAULT '',
    league_name TEXT NOT NULL DEFAULT '',
    sport TEXT NOT NULL DEFAULT '',
    market_id TEXT NOT NULL DEFAULT '',
    market_name TEXT NOT NULL DEFAULT '',
    market_kind TEXT NOT NULL DEFAULT 'unknown',
    period_key TEXT NOT NULL DEFAULT 'ft',
    line_key TEXT NOT NULL DEFAULT '',
    match_state TEXT NOT NULL DEFAULT 'unknown',
    event_start_at TIMESTAMPTZ,
    outcomes JSONB NOT NULL DEFAULT '{}'::jsonb,
    has_active_odds BOOLEAN NOT NULL DEFAULT FALSE,
    collected_at TIMESTAMPTZ NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_odds_pairs_source_current_key
ON odds_pairs (
    bookmaker_id,
    lobby_id,
    fixture_marker,
    market_kind,
    period_key,
    line_key
);

CREATE INDEX IF NOT EXISTS idx_odds_pairs_fixture_collected_at
ON odds_pairs (fixture_id, collected_at DESC);

CREATE INDEX IF NOT EXISTS idx_odds_pairs_fixture_market
ON odds_pairs (fixture_marker, market_kind, period_key, line_key);

CREATE INDEX IF NOT EXISTS idx_odds_pairs_state_start
ON odds_pairs (match_state, event_start_at, fixture_marker);

CREATE INDEX IF NOT EXISTS idx_odds_pairs_league_name
ON odds_pairs (league_name);

CREATE INDEX IF NOT EXISTS idx_odds_pairs_detector
ON odds_pairs (
    match_state,
    market_kind,
    period_key,
    line_key,
    fixture_marker,
    collected_at DESC
)
WHERE has_active_odds = TRUE
  AND market_kind IN ('handicap', 'over_under', 'one_x_two');

CREATE INDEX IF NOT EXISTS idx_odds_pairs_state_start_window
ON odds_pairs (
    match_state,
    event_start_at,
    collected_at DESC
)
WHERE has_active_odds = TRUE;
