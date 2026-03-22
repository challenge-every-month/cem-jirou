-- Migration: 0001_init
-- Initial schema for CEM Jirou

-- users
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER  PRIMARY KEY AUTOINCREMENT,
  slack_user_id TEXT     NOT NULL UNIQUE,
  user_name     TEXT     NOT NULL,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- user_preferences (1:1 with users)
CREATE TABLE IF NOT EXISTS user_preferences (
  id                INTEGER  PRIMARY KEY AUTOINCREMENT,
  user_id           INTEGER  NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  markdown_mode     BOOLEAN  NOT NULL DEFAULT FALSE,
  personal_reminder BOOLEAN  NOT NULL DEFAULT FALSE,
  viewed_year       INTEGER  DEFAULT NULL,
  viewed_month      INTEGER  DEFAULT NULL,
  created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- projects
CREATE TABLE IF NOT EXISTS projects (
  id         INTEGER  PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      TEXT     NOT NULL CHECK(length(title) <= 100),
  year       INTEGER  NOT NULL CHECK(year >= 2020),
  month      INTEGER  NOT NULL CHECK(month BETWEEN 1 AND 12),
  status     TEXT     NOT NULL DEFAULT 'draft'
             CHECK(status IN ('draft', 'published', 'reviewed')),
  is_inbox   BOOLEAN  NOT NULL DEFAULT FALSE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- challenges
CREATE TABLE IF NOT EXISTS challenges (
  id               INTEGER  PRIMARY KEY AUTOINCREMENT,
  project_id       INTEGER  NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name             TEXT     NOT NULL CHECK(length(name) <= 200),
  status           TEXT     NOT NULL DEFAULT 'draft'
                   CHECK(status IN ('draft', 'not_started', 'in_progress', 'completed', 'incompleted')),
  due_on           DATE     DEFAULT NULL,
  progress_comment TEXT     DEFAULT NULL,
  review_comment   TEXT     DEFAULT NULL,
  created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- version (health check)
CREATE TABLE IF NOT EXISTS version (
  id           INTEGER  PRIMARY KEY DEFAULT 1,
  version_code TEXT     NOT NULL,
  updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP
);
INSERT OR IGNORE INTO version (id, version_code) VALUES (1, 'v0.1.0');
