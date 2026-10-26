CREATE TABLE IF NOT EXISTS reports (
 id TEXT PRIMARY KEY,
 created_at TEXT NOT NULL,
 report TEXT NOT NULL,
 copy_requested INTEGER NOT NULL
);
