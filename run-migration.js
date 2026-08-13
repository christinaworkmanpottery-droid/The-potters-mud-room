const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

// Database connection (SQLite)
const DB_PATH = path.join(__dirname, 'data', 'pottery.db');

function runMigration(filename) {
  const migrationPath = path.join(__dirname, 'migrations', filename);
  
  if (!fs.existsSync(migrationPath)) {
    console.error(`Migration file not found: ${filename}`);
    process.exit(1);
  }

  const sql = fs.readFileSync(migrationPath, 'utf8');
  
  console.log(`Running migration: ${filename}`);
  console.log(`Database: ${DB_PATH}`);
  
  try {
    const db = new Database(DB_PATH);
    db.exec(sql);
    db.close();
    console.log('✓ Migration completed successfully');
  } catch (error) {
    console.error('✗ Migration failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Get migration filename from command line
const migrationFile = process.argv[2];

if (!migrationFile) {
  console.error('Usage: node run-migration.js <migration-filename>');
  process.exit(1);
}

runMigration(migrationFile);
