PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS markets (
  venue TEXT NOT NULL, chain_id TEXT NOT NULL, id TEXT NOT NULL, match_id TEXT NOT NULL,
  payload TEXT NOT NULL, PRIMARY KEY (venue, chain_id, id), UNIQUE (venue, chain_id, match_id)
);
CREATE TABLE IF NOT EXISTS market_outcomes (
  venue TEXT NOT NULL, chain_id TEXT NOT NULL, market_id TEXT NOT NULL, outcome_id INTEGER NOT NULL,
  payload TEXT NOT NULL, PRIMARY KEY (venue, chain_id, market_id, outcome_id),
  FOREIGN KEY (venue, chain_id, market_id) REFERENCES markets(venue, chain_id, id)
);
CREATE TABLE IF NOT EXISTS matcher_states (scope TEXT PRIMARY KEY, payload TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS hermes_execution_journals (scope TEXT PRIMARY KEY, payload TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS orders (
  scope TEXT NOT NULL, id TEXT NOT NULL, maker TEXT NOT NULL, status TEXT NOT NULL,
  price TEXT NOT NULL, quantity TEXT NOT NULL, filled TEXT NOT NULL, nonce TEXT NOT NULL,
  expires_at INTEGER NOT NULL, payload TEXT NOT NULL, PRIMARY KEY (scope, id)
);
CREATE INDEX IF NOT EXISTS orders_by_maker ON orders(maker, scope, status);
CREATE TABLE IF NOT EXISTS fills (
  scope TEXT NOT NULL, id TEXT NOT NULL, tx_hash TEXT NOT NULL, timestamp INTEGER NOT NULL,
  payload TEXT NOT NULL, PRIMARY KEY (scope, id)
);
CREATE TABLE IF NOT EXISTS positions (
  scope TEXT NOT NULL, account TEXT NOT NULL, outcome_id INTEGER NOT NULL, payload TEXT NOT NULL,
  PRIMARY KEY (scope, account, outcome_id)
);
CREATE TABLE IF NOT EXISTS balances (
  venue TEXT NOT NULL, chain_id TEXT NOT NULL, account TEXT NOT NULL, payload TEXT NOT NULL,
  PRIMARY KEY (venue, chain_id, account)
);
CREATE TABLE IF NOT EXISTS telemetry_snapshots (
  match_id TEXT PRIMARY KEY, sequence INTEGER NOT NULL, timestamp INTEGER NOT NULL, payload TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS market_prices (
  scope TEXT NOT NULL, outcome_id INTEGER NOT NULL, payload TEXT NOT NULL,
  PRIMARY KEY (scope, outcome_id)
);
CREATE TABLE IF NOT EXISTS agent_vaults (
  venue TEXT NOT NULL, chain_id TEXT NOT NULL, account TEXT NOT NULL, payload TEXT NOT NULL,
  PRIMARY KEY (venue, chain_id, account)
);
CREATE TABLE IF NOT EXISTS agent_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, venue TEXT NOT NULL, chain_id TEXT NOT NULL,
  account TEXT NOT NULL, timestamp INTEGER NOT NULL, payload TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS consumed_nonces (scope TEXT NOT NULL, nonce TEXT NOT NULL, expires_at INTEGER NOT NULL, PRIMARY KEY (scope, nonce));
CREATE TABLE IF NOT EXISTS indexer_checkpoints (source TEXT PRIMARY KEY, cursor TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS indexed_events (source TEXT NOT NULL, id TEXT NOT NULL, PRIMARY KEY (source, id));
CREATE TABLE IF NOT EXISTS events (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT, topic TEXT NOT NULL, type TEXT NOT NULL,
  payload TEXT NOT NULL, timestamp INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS events_by_topic ON events(topic, sequence);
