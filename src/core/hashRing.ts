import crypto from 'crypto';
import Redis from 'ioredis';

/**
 * Consistent Hash Ring implementation.
 */
export class HashRing {
  // A sorted list of virtual node hashes (MD5 hex strings) representing positions on the ring.
  private ring: string[] = [];

  // A map from virtual node hash -> Physical Redis client instance.
  private nodeMap: Map<string, Redis> = new Map();

  // Keep track of our physical Redis clients to shut them down cleanly if needed
  public clients: { [key: string]: Redis } = {};

  constructor() {
    // Initialize our 3 physical Redis nodes
    // Using host 'localhost' because the Node process runs on the host machine,
    // accessing the containers via the forwarded ports: 6380, 6381, 6382.
    this.clients['redis-a'] = new Redis({ host: '127.0.0.1', port: 6380 });
    this.clients['redis-b'] = new Redis({ host: '127.0.0.1', port: 6381 });
    this.clients['redis-c'] = new Redis({ host: '127.0.0.1', port: 6382 });

    // Handle connection error logging so failure in one node does not crash the server.
    Object.entries(this.clients).forEach(([name, client]) => {
      client.on('error', (err) => {
        console.error(`[Redis Error] Node ${name} encountered an error:`, err.message);
      });
    });

    // Populate the hash ring
    this.initializeRing();
  }

  /**
   * Hashes a string using MD5 and returns a 32-character hexadecimal string.
   * Hex strings are fixed-length, meaning alphabetical sorting is equivalent to numeric sorting.
   */
  private hash(key: string): string {
    return crypto.createHash('md5').update(key).digest('hex');
  }

  /**
   * Initializes the ring by mapping 100 virtual nodes for each of our 3 Redis servers.
   */
  private initializeRing() {
    const physicalNodes = ['redis-a', 'redis-b', 'redis-c'];
    const virtualNodeCount = 100;

    for (const node of physicalNodes) {
      const client = this.clients[node];
      for (let i = 0; i < virtualNodeCount; i++) {
        // e.g., "redis-a-0", "redis-a-1" etc.
        const vNodeName = `${node}-${i}`;
        const vNodeHash = this.hash(vNodeName);

        this.ring.push(vNodeHash);
        this.nodeMap.set(vNodeHash, client);
      }
    }

    // Sort the ring hashes in ascending order.
    // This allows us to search the ring in a clockwise direction.
    this.ring.sort();
  }

  /**
   * Returns the Redis client responsible for the given key.
   */
  public getNode(key: string): Redis {
    if (this.ring.length === 0) {
      throw new Error('HashRing is empty or uninitialized');
    }

    // Hash the key to find its position on the ring
    const keyHash = this.hash(key);

    // Perform a Binary Search (O(log N)) to find the first virtual node hash >= keyHash (clockwise).
    // This is much faster than linear search when scaling up the number of nodes.
    let low = 0;
    let high = this.ring.length - 1;
    let targetIdx = 0; // If no hash >= keyHash is found, we wrap around to the first element (index 0)

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      if (this.ring[mid] >= keyHash) {
        targetIdx = mid;
        high = mid - 1; // Try to find an even closer match to the left
      } else {
        low = mid + 1;  // Keep looking to the right
      }
    }

    const targetHash = this.ring[targetIdx];
    return this.nodeMap.get(targetHash)!;
  }
}

// Export a single instance to share across the application
export const hashRing = new HashRing();
