-- Ensure only one Worker synthesizes a MeloTTS cache key at a time.
-- Expiring leases recover safely if a Worker is terminated mid-generation.
CREATE TABLE IF NOT EXISTS tts_generation_locks (
  key TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
