-- Add custom_clay_type field to store user-entered clay type when clay_type='other'
ALTER TABLE clay_bodies ADD COLUMN custom_clay_type TEXT;
