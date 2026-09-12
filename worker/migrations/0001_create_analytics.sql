CREATE TABLE lifetime_visits (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  total INTEGER NOT NULL DEFAULT 0 CHECK (total >= 0)
);

CREATE TABLE daily_visits (
  date TEXT PRIMARY KEY CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  total INTEGER NOT NULL DEFAULT 0 CHECK (total >= 0)
);

INSERT INTO lifetime_visits (id, total) VALUES (1, 0);
