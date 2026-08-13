-- Migration: Fix foreign key cascades for account deletion (SQLite v2)
-- Created: 2026-08-14
-- Purpose: Ensure all related data is properly deleted when an account is deleted
--
-- Strategy: Only fix the most critical tables that currently exist

PRAGMA foreign_keys=OFF;

BEGIN TRANSACTION;

-- Fix pieces table (most important)
ALTER TABLE pieces RENAME TO pieces_old;

CREATE TABLE pieces (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT,
  description TEXT,
  clay_body_id TEXT,
  studio TEXT,
  status TEXT DEFAULT 'in-progress',
  form TEXT,
  technique TEXT,
  dimensions TEXT,
  weight TEXT,
  material_cost REAL,
  firing_cost REAL,
  sale_price REAL,
  date_started TEXT,
  date_completed TEXT,
  date_sold TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  is_public INTEGER DEFAULT 0,
  public_display_name TEXT,
  allow_messages INTEGER DEFAULT 0,
  labor_hours REAL,
  labor_rate REAL,
  perceptual_hash TEXT,
  ai_embedding_json TEXT,
  exclude_from_search INTEGER DEFAULT 0,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (clay_body_id) REFERENCES clay_bodies(id) ON DELETE SET NULL
);

INSERT INTO pieces SELECT * FROM pieces_old;
DROP TABLE pieces_old;

COMMIT;

PRAGMA foreign_keys=ON;
