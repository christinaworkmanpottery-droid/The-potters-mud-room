const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false }
});

async function runMigration(filename) {
  const migrationPath = path.join(__dirname, 'migrations', filename);
  
  if (!fs.existsSync(migrationPath)) {
    console.error(`Migration file not found: ${filename}`);
    process.exit(1);
  }

  const sql = fs.readFileSync(migrationPath, 'utf8');
  
  console.log(`Running migration: ${filename}`);
  
  try {
    await pool.query(sql);
    console.log('✓ Migration completed successfully');
  } catch (error) {
    console.error('✗ Migration failed:', error.message);
    throw error;
  } finally {
    await pool.end();
  }
}

// Get migration filename from command line
const migrationFile = process.argv[2];

if (!migrationFile) {
  console.error('Usage: node run-migration.js <migration-filename>');
  process.exit(1);
}

runMigration(migrationFile);
