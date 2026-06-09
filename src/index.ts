import app from './app';
import { pool } from './db';
import { ZarrOracleService } from './services/ZarrOracleService';
import { ZarrHedgeService } from './services/ZarrHedgeService';

const PORT = process.env.PORT || 3000;

const oracleService = new ZarrOracleService();
const hedgeService = new ZarrHedgeService();

const server = app.listen(PORT, () => {
  console.log(`==================================================`);
  console.log(` MelliZarr Core API Server started successfully!`);
  console.log(` Listening on: http://localhost:${PORT}`);
  console.log(` Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`==================================================`);

  // Boot background workers
  oracleService.start();
  hedgeService.start();
});

/**
 * Handles graceful shutdown of the server and database connections.
 */
async function gracefulShutdown(signal: string) {
  console.log(`\nReceived ${signal}. Starting graceful shutdown...`);

  // Stop background workers
  console.log('Stopping background services...');
  oracleService.stop();
  hedgeService.stop();

  // Stop accepting new connections
  server.close(async () => {
    console.log('HTTP server stopped.');

    try {
      // Close the pg pool
      console.log('Closing database connection pool...');
      await pool.end();
      console.log('Database connection pool closed successfully.');
      process.exit(0);
    } catch (error) {
      console.error('Error during database pool shutdown:', error);
      process.exit(1);
    }
  });

  // Force close after 10 seconds if graceful shutdown hangs
  setTimeout(() => {
    console.error('Force shutting down after timeout.');
    process.exit(1);
  }, 10000);
}

// Intercept termination signals
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

