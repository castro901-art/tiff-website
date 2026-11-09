CREATE TABLE IF NOT EXISTS tiffbot_waitlist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tiffbot_waitlist_expires_at
  ON tiffbot_waitlist (expires_at);
