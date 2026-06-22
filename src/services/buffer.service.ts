import { flushBufferedQueriesToDb } from '../models/search.model';

// In-memory write buffer
export const writeBuffer = new Map<string, number>();

/**
 * Push search queries into the in-memory write buffer.
 */
export function recordSearch(query: string): void {
  const queryClean = query.trim();
  if (queryClean === '') return;

  const currentCount = writeBuffer.get(queryClean) || 0;
  writeBuffer.set(queryClean, currentCount + 1);
}

/**
 * Flush the writeBuffer into PostgreSQL. Handles backups/restores on transaction failure.
 */
export async function flushBuffer(): Promise<void> {
  if (writeBuffer.size === 0) return;

  console.log(`[Buffer Service] Flushing ${writeBuffer.size} queries from buffer to Postgres...`);
  
  const snapshot = new Map(writeBuffer);
  writeBuffer.clear();

  try {
    await flushBufferedQueriesToDb(snapshot);
    console.log('[Buffer Service] Successfully flushed buffer to database.');
  } catch (error: any) {
    console.error('[Buffer Service Error] Failed to flush write buffer:', error.message);
    
    // In case of error, restore snapshot back into the writeBuffer to prevent data loss
    for (const [queryText, count] of snapshot.entries()) {
      const current = writeBuffer.get(queryText) || 0;
      writeBuffer.set(queryText, current + count);
    }
    throw error;
  }
}
