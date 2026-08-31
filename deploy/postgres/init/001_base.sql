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
