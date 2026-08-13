-- Migration: Fix foreign key cascades for account deletion (SQLite)
-- Created: 2026-08-14
-- Purpose: Ensure all related data is properly deleted when an account is deleted
--
-- Note: SQLite doesn't support ALTER TABLE ... DROP CONSTRAINT.
-- Instead, we need to recreate tables with proper ON DELETE CASCADE constraints.
-- This migration handles the most critical tables for account deletion.

PRAGMA foreign_keys=OFF;

BEGIN TRANSACTION;

-- Fix clay_bodies table
CREATE TABLE clay_bodies_new (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  brand TEXT,
  color_wet TEXT,
  color_fired TEXT,
  shrinkage_pct REAL,
  cone_range TEXT,
  clay_type TEXT CHECK(clay_type IN ('stoneware', 'porcelain', 'earthenware', 'terracotta', 'raku', 'other')),
  cost_per_bag REAL,
  bag_weight TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

INSERT INTO clay_bodies_new SELECT * FROM clay_bodies;
DROP TABLE clay_bodies;
ALTER TABLE clay_bodies_new RENAME TO clay_bodies;

-- Fix glazes table
CREATE TABLE glazes_new (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  glaze_type TEXT DEFAULT 'commercial' CHECK(glaze_type IN ('commercial', 'recipe')),
  brand TEXT,
  sku TEXT,
  color_description TEXT,
  cone_range TEXT,
  atmosphere TEXT CHECK(atmosphere IN ('oxidation', 'reduction', 'neutral', 'any', NULL)),
  surface TEXT CHECK(surface IN ('gloss', 'satin', 'matte', 'crystal', 'other', NULL)),
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

INSERT INTO glazes_new SELECT * FROM glazes;
DROP TABLE glazes;
ALTER TABLE glazes_new RENAME TO glazes;

-- Fix pieces table
CREATE TABLE pieces_new (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT,
  description TEXT,
  clay_body_id TEXT,
  studio TEXT,
  status TEXT DEFAULT 'in-progress' CHECK(status IN ('in-progress', 'leather-hard', 'bone-dry', 'bisque-fired', 'glazed', 'glaze-fired', 'done', 'sold', 'broken', 'recycled')),
  form TEXT,
  technique TEXT CHECK(technique IN ('wheel-thrown', 'hand-built', 'slab', 'coil', 'pinch', 'slip-cast', 'other', NULL)),
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
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (clay_body_id) REFERENCES clay_bodies(id) ON DELETE SET NULL
);

INSERT INTO pieces_new SELECT * FROM pieces;
DROP TABLE pieces;
ALTER TABLE pieces_new RENAME TO pieces;

COMMIT;

PRAGMA foreign_keys=ON;
