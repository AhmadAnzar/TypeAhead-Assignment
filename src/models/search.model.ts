import { pool } from '../core/db';

/**
 * Fetch suggestions from Postgres based on case-insensitive prefix search.
 * Includes tiered recency bonus scoring.
 */
export async function getSuggestionsFromDb(prefix: string): Promise<string[]> {
  const queryPrefix = prefix.trim().toLowerCase();
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
  return dbResult.rows.map(row => row.query);
}

/**
 * Fetch top 5 popular search queries.
 */
export async function getTrendingFromDb(): Promise<string[]> {
  const dbResult = await pool.query(
    `
    SELECT query 
    FROM search_queries 
    ORDER BY last_searched_at DESC, total_count DESC 
    LIMIT 5
    `
  );
  return dbResult.rows.map(row => row.query);
}

/**
 * Flushes buffered queries to the database using an upsert transaction.
 */
export async function flushBufferedQueriesToDb(snapshot: Map<string, number>): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

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
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
