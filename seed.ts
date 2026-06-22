import fs from 'fs';
import readline from 'readline';
import path from 'path';
import { pool, initializeDatabase } from './src/core/db';

/**
 * Seeding Script.
 * Reads the combined 'final_csv.csv' and seeds the database with the top 100,000 records.
 */
async function seedDatabase() {
  await initializeDatabase();

  const csvFilePath = path.join(__dirname, 'final_csv.csv');
  if (!fs.existsSync(csvFilePath)) {
    console.error(`Error: final_csv.csv not found at ${csvFilePath}. Please run combine_datasets.py first.`);
    process.exit(1);
  }

  const fileStream = fs.createReadStream(csvFilePath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  console.log('Seeding database with top 100,000 queries...');

  let batch: { query: string; count: number }[] = [];
  const BATCH_SIZE = 5000;
  // const MAX_ROWS = 100000;
  const MAX_ROWS=800000;
  let totalSeeded = 0;
  let isHeader = true;

  const client = await pool.connect();

  try {
    // Start transaction to speed up inserts
    await client.query('BEGIN');

    for await (const line of rl) {
      if (isHeader) {
        isHeader = false;
        continue;
      }

      // Simple CSV parser for "query,count"
      const lastCommaIdx = line.lastIndexOf(',');
      if (lastCommaIdx === -1) continue;

      const queryVal = line.substring(0, lastCommaIdx).trim();
      const countVal = parseInt(line.substring(lastCommaIdx + 1), 10);

      // Clean up quote marks if present around the query
      let queryClean = queryVal;
      if (queryClean.startsWith('"') && queryClean.endsWith('"')) {
        queryClean = queryClean.substring(1, queryClean.length - 1);
      }

      if (!queryClean || isNaN(countVal)) continue;

      batch.push({ query: queryClean, count: countVal });

      if (batch.length === BATCH_SIZE) {
        await executeBatchInsert(client, batch);
        totalSeeded += batch.length;
        console.log(`Seeded ${totalSeeded} rows...`);
        batch = [];

        if (totalSeeded >= MAX_ROWS) {
          break;
        }
      }
    }

    // Insert remaining rows in final batch
    if (batch.length > 0 && totalSeeded < MAX_ROWS) {
      const remainingCount = Math.min(batch.length, MAX_ROWS - totalSeeded);
      await executeBatchInsert(client, batch.slice(0, remainingCount));
      totalSeeded += remainingCount;
      console.log(`Seeded ${totalSeeded} rows...`);
    }

    await client.query('COMMIT');
    console.log(`Successfully completed seeding! Total seeded: ${totalSeeded} queries.`);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error seeding database:', error);
  } finally {
    client.release();
    await pool.end();
  }
}

/**
 * Builds and executes a single multi-row INSERT ... ON CONFLICT DO NOTHING statement.
 */
async function executeBatchInsert(client: any, items: { query: string; count: number }[]) {
  // Construct parameterized bulk insert query
  // e.g. INSERT INTO search_queries (query, total_count, recent_score) VALUES ($1, $2, $3), ($4, $5, $6)...
  const valuePlaceholders: string[] = [];
  const queryArgs: any[] = [];

  items.forEach((item, idx) => {
    const baseIdx = idx * 2;
    valuePlaceholders.push(`($${baseIdx + 1}, $${baseIdx + 2})`);
    queryArgs.push(item.query, item.count);
  });

  const sql = `
    INSERT INTO search_queries (query, total_count)
    VALUES ${valuePlaceholders.join(', ')}
    ON CONFLICT (query) DO NOTHING
  `;

  await client.query(sql, queryArgs);
}

seedDatabase();
