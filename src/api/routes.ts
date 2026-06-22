import { Router, Request, Response } from 'express';
import { hashRing } from '../core/hashRing';
import { getSuggestionsFromDb, getTrendingFromDb } from '../models/search.model';
import { recordSearch } from '../services/buffer.service';
import { CacheDebugResponse } from '../schemas/search.schema';

export const router = Router();

/**
 * 1. SUGGEST / READ PATH: `/suggest?q=<prefix>`
 * Returns the top 10 completions for the given prefix.
 */
router.get('/suggest', async (req: Request, res: Response) => {
  const prefix = req.query.q;

  if (typeof prefix !== 'string' || prefix.trim() === '') {
    return res.json([]);
  }

  const queryPrefix = prefix.trim().toLowerCase();
  const cacheKey = `suggest:${queryPrefix}`;

  // Find the mapped Redis client using Consistent Hashing.
  const redisNode = hashRing.getNode(cacheKey);
  let nodeName = 'unknown';
  for (const [name, client] of Object.entries(hashRing.clients)) {
    if (client === redisNode) {
      nodeName = name;
      break;
    }
  }

  try {
    // Step A: Attempt to fetch from Redis cache (O(1) operation)
    const cachedData = await redisNode.get(cacheKey);
    if (cachedData) {
      res.setHeader('X-Cache', 'HIT');
      res.setHeader('X-Redis-Node', nodeName);
      return res.json(JSON.parse(cachedData));
    }

    // CACHE MISS: Query PostgreSQL
    const suggestions = await getSuggestionsFromDb(queryPrefix);

    // Save back to Redis cache with 300 seconds TTL
    await redisNode.setex(cacheKey, 300, JSON.stringify(suggestions));

    res.setHeader('X-Cache', 'MISS');
    res.setHeader('X-Redis-Node', nodeName);
    return res.json(suggestions);

  } catch (error: any) {
    console.error(`[Suggest Error] Failed lookup for key "${cacheKey}":`, error.message);

    try {
      // Graceful degradation: fall back directly to Database
      const suggestions = await getSuggestionsFromDb(queryPrefix);
      res.setHeader('X-Cache', 'FALLBACK');
      res.setHeader('X-Redis-Node', 'N/A');
      return res.json(suggestions);
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
router.post('/search', (req: Request, res: Response) => {
  const { query } = req.body;

  if (typeof query !== 'string' || query.trim() === '') {
    return res.status(400).json({ error: 'Query is required' });
  }

  recordSearch(query);

  return res.status(200).json({ message: 'Searched' });
});

/**
 * GET /trending
 * Returns the top 5 overall popular search queries (trending) to display in the UI.
 */
router.get('/trending', async (req: Request, res: Response) => {
  try {
    const trending = await getTrendingFromDb();
    return res.json(trending);
  } catch (error: any) {
    console.error('[Trending Endpoint Error]:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /cache/debug?prefix=<prefix>
 * Shows which cache node is responsible for the prefix and whether it is a hit or miss.
 */
router.get('/cache/debug', async (req: Request, res: Response) => {
  const prefix = req.query.prefix;

  if (typeof prefix !== 'string' || prefix.trim() === '') {
    return res.status(400).json({ error: 'Prefix is required' });
  }

  const queryPrefix = prefix.trim().toLowerCase();
  const cacheKey = `suggest:${queryPrefix}`;

  try {
    const redisNode = hashRing.getNode(cacheKey);
    
    let nodeName = 'unknown';
    for (const [name, client] of Object.entries(hashRing.clients)) {
      if (client === redisNode) {
        nodeName = name;
        break;
      }
    }

    const cachedData = await redisNode.get(cacheKey);
    const isHit = cachedData !== null;

    const responseData: CacheDebugResponse = {
      prefix: queryPrefix,
      cacheKey,
      node: nodeName,
      hit: isHit
    };

    return res.json(responseData);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});
