-- The relay's D1 tables. Apply once: npx wrangler d1 execute thicken-contribute --remote --file schema.sql
-- prefix is HMAC-SHA256(IP_SALT, the IPv4 /32 or IPv6 /64), 16 hex; only incidents keep a full IP (README.md).
CREATE TABLE IF NOT EXISTS photos (id TEXT PRIMARY KEY, sha256 TEXT NOT NULL UNIQUE, at TEXT NOT NULL, prefix TEXT NOT NULL, asn INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS photos_at ON photos (at);
CREATE TABLE IF NOT EXISTS counters (day TEXT NOT NULL, key TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (day, key));
CREATE TABLE IF NOT EXISTS incidents (id TEXT PRIMARY KEY, at TEXT NOT NULL, sha256 TEXT NOT NULL, ip TEXT NOT NULL, asn INTEGER NOT NULL, ua TEXT NOT NULL, matched TEXT NOT NULL, answered TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS forgotten (id TEXT PRIMARY KEY, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS rejections (at TEXT NOT NULL, reason TEXT NOT NULL, sexual REAL NOT NULL, face REAL NOT NULL, topic REAL NOT NULL);
