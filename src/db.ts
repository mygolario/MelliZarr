import { Pool } from 'pg';
import * as dotenv from 'dotenv';

// Load environment variables
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

// Create a new connection pool
export const pool = new Pool({
  ...config,
  max: 20, // maximum number of clients in the pool
  idleTimeoutMillis: 30000, // how long a client is allowed to remain idle before being closed
  connectionTimeoutMillis: 2000, // how long to wait when connecting before timing out
});

/**
 * Executes a query helper on the database pool.
 * @param text SQL query string
 * @param params query parameters
 */
export const query = (text: string, params?: any[]) => {
  return pool.query(text, params);
};
