-- Additive migration: legacy reports table is retained, never dropped.
CREATE TABLE IF NOT EXISTS reports (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, report TEXT NOT NULL, copy_requested INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS submissions (
 id TEXT PRIMARY KEY, submission_key TEXT NOT NULL UNIQUE, receipt_hash TEXT NOT NULL,
 payload_hash TEXT NOT NULL, created_at TEXT NOT NULL, show_date TEXT NOT NULL,
 show_key TEXT NOT NULL, breed TEXT NOT NULL, bsi_version TEXT NOT NULL,
 total INTEGER NOT NULL CHECK(total>0), quality INTEGER NOT NULL, placing INTEGER NOT NULL,
 report_json TEXT NOT NULL, pdf_key TEXT
);
CREATE INDEX IF NOT EXISTS submissions_date_breed ON submissions(show_date,breed);
CREATE TABLE IF NOT EXISTS assessments (
 report_id TEXT NOT NULL REFERENCES submissions(id), area_index INTEGER NOT NULL,
 area TEXT NOT NULL, none_count INTEGER NOT NULL, mild INTEGER NOT NULL,
 clear_count INTEGER NOT NULL, severe INTEGER NOT NULL, not_assessed INTEGER NOT NULL,
 PRIMARY KEY(report_id,area_index)
);
CREATE TABLE IF NOT EXISTS recipients (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, active INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS deliveries (
 id TEXT PRIMARY KEY, report_id TEXT NOT NULL REFERENCES submissions(id), email TEXT NOT NULL,
 purpose TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
 next_attempt INTEGER NOT NULL DEFAULT 0, lease_until INTEGER NOT NULL DEFAULT 0,
 first_attempt INTEGER, provider_id TEXT, last_error TEXT, updated_at TEXT NOT NULL,
 UNIQUE(report_id,email)
);
CREATE INDEX IF NOT EXISTS delivery_due ON deliveries(status,next_attempt,lease_until);
CREATE UNIQUE INDEX IF NOT EXISTS provider_delivery ON deliveries(provider_id) WHERE provider_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS delivery_events (id TEXT PRIMARY KEY, delivery_id TEXT, report_id TEXT, event TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS audit_log (id TEXT PRIMARY KEY, actor TEXT NOT NULL, action TEXT NOT NULL, target TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS webhook_events (id TEXT PRIMARY KEY, created_at TEXT NOT NULL);
-- Optional one-off legacy imports require operator review: unknown BSI versions stay unversioned.
CREATE TABLE IF NOT EXISTS provider_events (id TEXT PRIMARY KEY, provider_id TEXT NOT NULL, event_type TEXT NOT NULL, occurred_at TEXT NOT NULL);
