import { Client } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

const connectionString = process.env.DATABASE_URL;
const config = connectionString
  ? { connectionString }
  : {
      host: process.env.PGHOST || 'localhost',
      port: parseInt(process.env.PGPORT || '5432'),
      user: process.env.PGUSER || 'postgres',
      password: process.env.PGPASSWORD,
      database: process.env.PGDATABASE || 'postgres',
    };

async function main() {
  console.log('Connecting to the database...');
  const client = new Client(config);

  try {
    await client.connect();
    console.log('Connected successfully.');

    const sqlPath = path.join(__dirname, 'postgresql_database_initialization_script.sql');
    if (!fs.existsSync(sqlPath)) {
      throw new Error(`Schema file not found at ${sqlPath}`);
    }

    console.log(`Reading SQL schema from ${sqlPath}...`);
    const sql = fs.readFileSync(sqlPath, 'utf8');

    console.log('Executing database schema initialization...');
    await client.query(sql);

    console.log('Database initialized and tables created successfully.');
  } catch (error) {
    console.error('Initialization failed:', error);
    process.exit(1);
  } finally {
    await client.end();
    console.log('Database connection closed.');
  }
}

main();
