CREATE TABLE IF NOT EXISTS docs (
  kind TEXT NOT NULL,          -- client | conv | rev | req | user | service | single
  id TEXT NOT NULL,
  k TEXT,                      -- chave de busca (telefone do cliente, cid da conversa)
  json TEXT NOT NULL,
  updated TEXT NOT NULL,
  PRIMARY KEY (kind, id)
);
CREATE INDEX IF NOT EXISTS docs_k ON docs(kind, k);
CREATE TABLE IF NOT EXISTS sessions (
  th TEXT PRIMARY KEY,         -- SHA-256 do token
  user_id TEXT NOT NULL,
  exp INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS attempts (
  ip TEXT PRIMARY KEY, n INTEGER NOT NULL, until INTEGER NOT NULL
);
