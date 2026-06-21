import express from 'express';
import path from 'path';
import cron from 'node-cron';
import { hashRing } from './hashRing';
import { pool, initializeDatabase } from './db';

const app = express();
const PORT = 3000;

// Enable JSON middleware to parse POST request bodies
app.use(express.json());

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

/**
 * IN-MEMORY BATCH BUFFER FOR WRITE PATH.
 */
let writeBuffer = new Map<string, number>();

/**
 * 1. SUGGEST / READ PATH: `/suggest?q=<prefix>`
 * Returns the top 10 completions for the given prefix.
 */
app.get('/suggest', async (req, res) => {
  const prefix = req.query.q;

  if (typeof prefix !== 'string' || prefix.trim() === '') {
    return res.json([]);
  }

  const queryPrefix = prefix.trim().toLowerCase();
  const cacheKey = `suggest:${queryPrefix}`;

  // Find the mapped Redis client using Consistent Hashing.
  // This guarantees that the key is routed to the exact same Redis node every time.
  const redisNode = hashRing.getNode(cacheKey);

  try {
    // Step A: Attempt to fetch from Redis cache (O(1) operation)
    const cachedData = await redisNode.get(cacheKey);
    if (cachedData) {
      // CACHE HIT: Return instantly.
      // We append a header to verify the hit during testing.
      res.setHeader('X-Cache', 'HIT');
      return res.json(JSON.parse(cachedData));
    }

    // CACHE MISS: Query PostgreSQL (using the indexed LOWER(query) prefix search)
    // Formula explanation:
    // Total Score = Base Count + Tiered Recency Bonus
    // This dynamically boosts recently searched items without modifying historical data.
    const dbResult = await pool.query(
      `
      SELECT query 
      FROM search_queries 
      WHERE LOWER(query) LIKE $1 
      ORDER BY total_count + (
        CASE 
          WHEN last_searched_at >= NOW() - INTERVAL '2 hours' THEN 1500
          WHEN last_searched_at >= NOW() - INTERVAL '24 hours' THEN 750
          WHEN last_searched_at >= NOW() - INTERVAL '3 days' THEN 300
          WHEN last_searched_at >= NOW() - INTERVAL '7 days' THEN 100
          ELSE 0
        END
      ) DESC 
      LIMIT 10
      `,
      [`${queryPrefix}%`]
    );

    const suggestions = dbResult.rows.map(row => row.query);

    // Save the retrieved suggestions back to the responsible Redis node
    // with a TTL (Time-To-Live) of 300 seconds (5 minutes) to keep cache fresh.
    await redisNode.setex(cacheKey, 300, JSON.stringify(suggestions));

    res.setHeader('X-Cache', 'MISS');
    return res.json(suggestions);

  } catch (error: any) {
    // Graceful degradation: Log errors, but fall back to direct database query 
    // so a single Redis node crash does not break the website for users.
    console.error(`[Suggest Error] Failed lookup for key "${cacheKey}":`, error.message);

    try {
      const dbResult = await pool.query(
        `
        SELECT query 
        FROM search_queries 
        WHERE LOWER(query) LIKE $1 
        ORDER BY total_count + (
          CASE 
            WHEN last_searched_at >= NOW() - INTERVAL '2 hours' THEN 1500
            WHEN last_searched_at >= NOW() - INTERVAL '24 hours' THEN 750
            WHEN last_searched_at >= NOW() - INTERVAL '3 days' THEN 300
            WHEN last_searched_at >= NOW() - INTERVAL '7 days' THEN 100
            ELSE 0
          END
        ) DESC 
        LIMIT 10
        `,
        [`${queryPrefix}%`]
      );
      return res.json(dbResult.rows.map(row => row.query));
    } catch (dbError: any) {
      console.error('[Suggest DB Fallback Error]:', dbError.message);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
});

/**
 * 2. SEARCH / WRITE PATH: `/search`
 * Increments search counts in memory. Fast response time.
 */
app.post('/search', (req, res) => {
  const { query } = req.body;

  if (typeof query !== 'string' || query.trim() === '') {
    return res.status(400).json({ error: 'Query is required' });
  }

  const queryClean = query.trim();

  // Buffer the write in the in-memory Map
  const currentCount = writeBuffer.get(queryClean) || 0;
  writeBuffer.set(queryClean, currentCount + 1);

  // Return a success response immediately (ultra-low latency write path)
  return res.status(200).json({ message: 'Searched' });
});

/**
 * GET /cache/debug?prefix=<prefix>
 * Shows which cache node is responsible for the prefix and whether it is a hit or miss.
 */
app.get('/cache/debug', async (req, res) => {
  const prefix = req.query.prefix;

  if (typeof prefix !== 'string' || prefix.trim() === '') {
    return res.status(400).json({ error: 'Prefix is required' });
  }

  const queryPrefix = prefix.trim().toLowerCase();
  const cacheKey = `suggest:${queryPrefix}`;

  try {
    const redisNode = hashRing.getNode(cacheKey);
    
    // Find the node name from the clients map
    let nodeName = 'unknown';
    for (const [name, client] of Object.entries(hashRing.clients)) {
      if (client === redisNode) {
        nodeName = name;
        break;
      }
    }

    const cachedData = await redisNode.get(cacheKey);
    const isHit = cachedData !== null;

    return res.json({
      prefix: queryPrefix,
      cacheKey,
      node: nodeName,
      hit: isHit
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

/**
 * GET /trending
 * Returns the top 5 overall popular search queries (trending) to display in the UI.
 * Sorted by recent_score to prioritize recent trending searches.
 */
app.get('/trending', async (req, res) => {
  try {
    const dbResult = await pool.query(
      `
      SELECT query 
      FROM search_queries 
      ORDER BY last_searched_at DESC, total_count DESC 
      LIMIT 5
      `
    );
    return res.json(dbResult.rows.map(row => row.query));
  } catch (error: any) {
    console.error('[Trending Endpoint Error]:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * 3. CRON JOB: FLUSH BUFFER TO DATABASE
 * Scheduled to run every 10 seconds (using cron pattern).
 */
cron.schedule('*/10 * * * * *', async () => {
  let snapshot: Map<string, number> | null = null;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (writeBuffer.size > 0) {
      console.log(`[Cron] Flushing ${writeBuffer.size} queries from buffer to Postgres...`);
      snapshot = new Map(writeBuffer);
      writeBuffer.clear();

      const valuePlaceholders: string[] = [];
      const queryArgs: any[] = [];
      let idx = 0;

      for (const [queryText, count] of snapshot.entries()) {
        const baseIdx = idx * 2;
        valuePlaceholders.push(`($${baseIdx + 1}, $${baseIdx + 2})`);
        queryArgs.push(queryText, count);
        idx++;
      }

      const upsertSql = `
        INSERT INTO search_queries (query, total_count)
        VALUES ${valuePlaceholders.join(', ')}
        ON CONFLICT (query) DO UPDATE SET 
          total_count = search_queries.total_count + EXCLUDED.total_count,
          last_searched_at = CURRENT_TIMESTAMP;
      `;
      await client.query(upsertSql, queryArgs);
      console.log('[Cron] Successfully flushed buffer to database.');
    }

    await client.query('COMMIT');
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('[Cron Error] Transaction failed:', error.message);
    
    // In case of database error, restore snapshot back into writeBuffer
    if (snapshot) {
      for (const [queryText, count] of snapshot.entries()) {
        const current = writeBuffer.get(queryText) || 0;
        writeBuffer.set(queryText, current + count);
      }
    }
  } finally {
    client.release();
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
