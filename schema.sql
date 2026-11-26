CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    full_name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'officer',
    password_hash TEXT NOT NULL,
    must_change_password INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS visitors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reg_code TEXT UNIQUE NOT NULL,
    full_name TEXT NOT NULL,
    date_of_birth TEXT NOT NULL,
    relationship TEXT NOT NULL,
    cccd TEXT NOT NULL,
    soldier_name TEXT NOT NULL,
    unit_name TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    visit_location TEXT NOT NULL DEFAULT '',
    visitor_count INTEGER NOT NULL DEFAULT 1,
    note TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending',
    visit_date TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    checked_by TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_visitors_visit_date ON visitors (visit_date);
CREATE INDEX IF NOT EXISTS idx_visitors_soldier ON visitors (soldier_name);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    csrf_token TEXT NOT NULL,
    expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS login_attempts (
    ip TEXT NOT NULL,
    attempted_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_login_attempts_ip ON login_attempts (ip, attempted_at);

CREATE TABLE IF NOT EXISTS rate_limits (
    ip TEXT NOT NULL,
    created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_ip ON rate_limits (ip, created_at);

CREATE TABLE IF NOT EXISTS soldiers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    full_name TEXT NOT NULL,
    name_norm TEXT NOT NULL,
    unit_name TEXT NOT NULL DEFAULT '',
    rank_title TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_soldiers_name_norm ON soldiers (name_norm);
