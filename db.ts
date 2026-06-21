import { Pool } from 'pg';

// Configure the connection pool to PostgreSQL.
// Since the Node.js server runs on the host machine, we connect using localhost and the forwarded port 5433.
export const pool = new Pool({
  host: '127.0.0.1',
  port: 5433,
  database: 'typeahead_db',
  user: 'typeahead_user',
  password: 'typeahead_password',
  max: 20, // Max concurrent database connections in the pool
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

/**
 * Initializes the database schema.
 */
export async function initializeDatabase() {
  const client = await pool.connect();
  try {
    console.log('Initializing PostgreSQL database schema...');
    
    // Create the search queries table
    await client.query(`
      CREATE TABLE IF NOT EXISTS search_queries (
        query VARCHAR(255) PRIMARY KEY,
        total_count INT DEFAULT 0,
        last_searched_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Create the expression index on LOWER(query) for fast case-insensitive prefix searches
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_search_queries_query_lower 
      ON search_queries (LOWER(query) text_pattern_ops);
    `);

    console.log('Database initialization complete.');
  } catch (error) {
    console.error('Error initializing database schema:', error);
    throw error;
  } finally {
    client.release();
  }
}
