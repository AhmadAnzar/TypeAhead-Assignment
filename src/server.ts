import express from 'express';
import path from 'path';
import cron from 'node-cron';
import { initializeDatabase } from './core/db';
import { router as apiRouter } from './api/routes';
import { flushBuffer } from './services/buffer.service';

const app = express();
const PORT = 3000;

// Enable JSON middleware to parse POST request bodies
app.use(express.json());

// Serve static files from the 'public' directory
// Since server.ts is inside src/, the public folder is in the parent directory (../public)
app.use(express.static(path.join(__dirname, '../public')));

// Mount API routes
app.use(apiRouter);

// Start the cron scheduler (runs every 10 seconds to flush writeBuffer to database)
cron.schedule('*/10 * * * * *', async () => {
  try {
    await flushBuffer();
  } catch (error: any) {
    console.error('[Cron Error] Write buffer flush failed:', error.message);
  }
});

// Initialize database schema first, then start the server
initializeDatabase()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`====================================================`);
      console.log(`🚀 Search Typeahead Server running on http://localhost:${PORT}`);
      console.log(`====================================================`);
    });
  })
  .catch((err) => {
    console.error('Fatal: Failed to start server due to database initialization failure.', err);
    process.exit(1);
  });
