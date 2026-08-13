-- Migration: Fix foreign key cascades for account deletion
-- Created: 2026-08-14
-- Purpose: Ensure all related data is properly deleted when an account is deleted

-- Drop existing foreign keys that don't have proper CASCADE
ALTER TABLE pieces DROP CONSTRAINT IF EXISTS pieces_user_id_fkey;
ALTER TABLE clay_types DROP CONSTRAINT IF EXISTS clay_types_user_id_fkey;
ALTER TABLE glaze_recipes DROP CONSTRAINT IF EXISTS glaze_recipes_user_id_fkey;
ALTER TABLE firing_logs DROP CONSTRAINT IF EXISTS firing_logs_user_id_fkey;
ALTER TABLE events DROP CONSTRAINT IF EXISTS events_user_id_fkey;
ALTER TABLE studio_notes DROP CONSTRAINT IF EXISTS studio_notes_user_id_fkey;
ALTER TABLE expenses DROP CONSTRAINT IF EXISTS expenses_user_id_fkey;

-- Re-add foreign keys with ON DELETE CASCADE
ALTER TABLE pieces 
  ADD CONSTRAINT pieces_user_id_fkey 
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE clay_types 
  ADD CONSTRAINT clay_types_user_id_fkey 
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE glaze_recipes 
  ADD CONSTRAINT glaze_recipes_user_id_fkey 
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE firing_logs 
  ADD CONSTRAINT firing_logs_user_id_fkey 
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE events 
  ADD CONSTRAINT events_user_id_fkey 
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE studio_notes 
  ADD CONSTRAINT studio_notes_user_id_fkey 
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE expenses 
  ADD CONSTRAINT expenses_user_id_fkey 
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
