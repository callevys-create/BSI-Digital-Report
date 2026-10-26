-- Additive module in the SAME D1 database as submissions and assessments.
CREATE TABLE IF NOT EXISTS organising_clubs (id TEXT PRIMARY KEY, type TEXT NOT NULL CHECK(type IN ('regional','speciality')), name TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS club_aliases (alias_key TEXT PRIMARY KEY, club_id TEXT NOT NULL REFERENCES organising_clubs(id));
CREATE TABLE IF NOT EXISTS organiser_shows (
 id TEXT PRIMARY KEY, club_id TEXT NOT NULL REFERENCES organising_clubs(id), name TEXT NOT NULL,
 date TEXT NOT NULL, country TEXT NOT NULL, show_key TEXT NOT NULL,
 revision INTEGER NOT NULL DEFAULT 0, allocation_token TEXT
);
CREATE INDEX IF NOT EXISTS organiser_show_club_date ON organiser_shows(club_id,date);
CREATE TABLE IF NOT EXISTS ring_allocations (
 id TEXT PRIMARY KEY, show_id TEXT NOT NULL REFERENCES organiser_shows(id), revision INTEGER NOT NULL,
 ring TEXT NOT NULL, judge TEXT NOT NULL, breed TEXT NOT NULL,
 required INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS active_show_allocations ON ring_allocations(show_id,active);
CREATE TABLE IF NOT EXISTS ring_imports (id TEXT PRIMARY KEY, show_id TEXT NOT NULL, revision INTEGER NOT NULL, actor TEXT NOT NULL, created_at TEXT NOT NULL, allocation_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS report_links (
 report_id TEXT PRIMARY KEY REFERENCES submissions(id), club_id TEXT NOT NULL REFERENCES organising_clubs(id),
 show_id TEXT NOT NULL REFERENCES organiser_shows(id), ring TEXT NOT NULL, judge TEXT NOT NULL, breed TEXT NOT NULL, listed INTEGER NOT NULL DEFAULT 1,
 updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS report_link_show ON report_links(show_id);
CREATE TABLE IF NOT EXISTS club_access (
 email TEXT NOT NULL, club_id TEXT NOT NULL REFERENCES organising_clubs(id),
 role TEXT NOT NULL CHECK(role IN ('viewer','editor')), active INTEGER NOT NULL DEFAULT 1,
 PRIMARY KEY(email,club_id)
);
INSERT OR IGNORE INTO organising_clubs (id,type,name) VALUES ('blekinge','regional','Blekinge Kennelklubb');
INSERT OR IGNORE INTO organising_clubs (id,type,name) VALUES ('dalarna','regional','Dalarnas Kennelklubb');
INSERT OR IGNORE INTO organising_clubs (id,type,name) VALUES ('gotland','regional','Gotlands Kennelklubb');
INSERT OR IGNORE INTO organising_clubs (id,type,name) VALUES ('gastrikland','regional','Gästriklands Kennelklubb');
INSERT OR IGNORE INTO organising_clubs (id,type,name) VALUES ('halland','regional','Hallands Kennelklubb');
INSERT OR IGNORE INTO organising_clubs (id,type,name) VALUES ('halsingland','regional','Hälsinglands Kennelklubb');
INSERT OR IGNORE INTO organising_clubs (id,type,name) VALUES ('jamtland-harjedalen','regional','Jämtland-Härjedalens Kennelklubb');
INSERT OR IGNORE INTO organising_clubs (id,type,name) VALUES ('norra-norrbotten','regional','Norra Norrbottens Kennelklubb');
INSERT OR IGNORE INTO organising_clubs (id,type,name) VALUES ('norra-alvsborg','regional','Norra Älvsborgs Kennelklubb');
INSERT OR IGNORE INTO organising_clubs (id,type,name) VALUES ('skaraborg','regional','Skaraborgs Kennelklubb');
INSERT OR IGNORE INTO organising_clubs (id,type,name) VALUES ('skanska','regional','Skånska Kennelklubben');
INSERT OR IGNORE INTO organising_clubs (id,type,name) VALUES ('smaland-oland','regional','Småland-Ölands Kennelklubb');
INSERT OR IGNORE INTO organising_clubs (id,type,name) VALUES ('stockholm','regional','Stockholms Kennelklubb');
INSERT OR IGNORE INTO organising_clubs (id,type,name) VALUES ('sodermanland','regional','Södermanlands Kennelklubb');
INSERT OR IGNORE INTO organising_clubs (id,type,name) VALUES ('sodra-norrbotten','regional','Södra Norrbottens Kennelklubb');
INSERT OR IGNORE INTO organising_clubs (id,type,name) VALUES ('sodra-alvsborg','regional','Södra Älvsborgs Kennelklubb');
INSERT OR IGNORE INTO organising_clubs (id,type,name) VALUES ('uppsala','regional','Uppsala Läns Kennelklubb');
INSERT OR IGNORE INTO organising_clubs (id,type,name) VALUES ('varmland','regional','Värmlands Kennelklubb');
INSERT OR IGNORE INTO organising_clubs (id,type,name) VALUES ('vasterbotten','regional','Västerbottens Kennelklubb');
INSERT OR IGNORE INTO organising_clubs (id,type,name) VALUES ('vasternorrland','regional','Västernorrlands Kennelklubb');
INSERT OR IGNORE INTO organising_clubs (id,type,name) VALUES ('vastra','regional','Västra Kennelklubben');
INSERT OR IGNORE INTO organising_clubs (id,type,name) VALUES ('wastmanland','regional','Wästmanlands Kennelklubb');
INSERT OR IGNORE INTO organising_clubs (id,type,name) VALUES ('orebro','regional','Örebro Läns Kennelklubb');
INSERT OR IGNORE INTO organising_clubs (id,type,name) VALUES ('ostergotland','regional','Östergötlands Kennelklubb');
