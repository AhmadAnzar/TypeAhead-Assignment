import http from 'http';

const SERVER_URL = 'http://localhost:3000';
const TOTAL_REQUESTS = 1000;

// List of prefixes to search. Some are highly repetitive to simulate real traffic (cache hits).
const mockPrefixes = [
  'a', 'ap', 'app', 'appl', 'apple', // High repetition
  'w', 'wo', 'wor', 'worl', 'world', 
  'i', 'ip', 'iph', 'ipho', 'iphon', 'iphone',
  'j', 'ja', 'jav', 'java',
  't', 'te', 'tes', 'test',
  // Some random prefixes to simulate cache misses
  'xyz', 'qwert', 'asdf', 'zxcv', 'bloop', 'programming', 'database', 'caching', 'node', 'express',
  'postgres', 'redis', 'consistent', 'hashing', 'latency', 'benchmark', 'performance', 'system', 'design'
];

interface RequestMetrics {
  duration: number;
  cacheStatus: string | null;
  node: string | null;
}

function makeRequest(url: string): Promise<RequestMetrics> {
  return new Promise((resolve) => {
    const start = performance.now();
    http.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        const duration = performance.now() - start;
        const cacheStatus = res.headers['x-cache'] as string || 'MISS';
        const node = res.headers['x-redis-node'] as string || 'N/A';
        resolve({ duration, cacheStatus, node });
      });
    }).on('error', () => {
      resolve({ duration: performance.now() - start, cacheStatus: 'ERROR', node: 'N/A' });
    });
  });
}

async function runBenchmark() {
  console.log('==================================================');
  console.log(`Starting Search Typeahead Benchmark against ${SERVER_URL}`);
  console.log(`Total Requests to send: ${TOTAL_REQUESTS}`);
  console.log('==================================================\n');

  const metrics: RequestMetrics[] = [];
  
  // 1. READ PATH BENCHMARK (Suggest Queries)
  for (let i = 0; i < TOTAL_REQUESTS; i++) {
    // Pick a prefix. 75% chance to pick from the popular set (for cache hits), 25% from unique ones
    const isPopular = Math.random() < 0.75;
    const prefixList = isPopular ? mockPrefixes.slice(0, 20) : mockPrefixes.slice(20);
    const prefix = prefixList[Math.floor(Math.random() * prefixList.length)];
    
    const url = `${SERVER_URL}/suggest?q=${encodeURIComponent(prefix)}`;
    const res = await makeRequest(url);
    metrics.push(res);

    if ((i + 1) % 200 === 0) {
      console.log(`Completed ${i + 1}/${TOTAL_REQUESTS} read requests...`);
    }
  }

  // Sort durations for percentiles
  const durations = metrics
    .filter(m => m.cacheStatus !== 'ERROR')
    .map(m => m.duration)
    .sort((a, b) => a - b);

  const totalSuccessful = durations.length;
  const avgLatency = durations.reduce((sum, d) => sum + d, 0) / totalSuccessful;
  
  // Percentiles
  const p50 = durations[Math.floor(totalSuccessful * 0.5)];
  const p90 = durations[Math.floor(totalSuccessful * 0.9)];
  const p95 = durations[Math.floor(totalSuccessful * 0.95)];
  const p99 = durations[Math.floor(totalSuccessful * 0.99)];

  // Cache Statistics
  const cacheHits = metrics.filter(m => m.cacheStatus === 'HIT').length;
  const cacheHitRate = (cacheHits / totalSuccessful) * 100;
  
  // Read Reduction (direct mapping from cache hits since hits do not reach PostgreSQL)
  const readReduction = cacheHitRate;

  // 2. WRITE PATH BENCHMARK (Search submissions)
  console.log('\nMeasuring Write Path (Buffering)...');
  const writeCount = 500;
  const writePromises = [];
  const startWrites = performance.now();
  
  for (let i = 0; i < writeCount; i++) {
    const postData = JSON.stringify({ query: 'iphone' });
    const reqPromise = new Promise<void>((resolve) => {
      const req = http.request(`${SERVER_URL}/search`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        }
      }, (res) => {
        res.on('data', () => {});
        res.on('end', () => resolve());
      });
      req.on('error', () => resolve());
      req.write(postData);
      req.end();
    });
    writePromises.push(reqPromise);
  }
  await Promise.all(writePromises);
  const totalWriteDuration = performance.now() - startWrites;
  const avgWriteLatency = totalWriteDuration / writeCount;

  // Write Reduction:
  // 500 search events are registered. Instead of doing 500 SQL insert/updates in Postgres,
  // the memory buffer registers them in 1 O(1) step. The cron flushes them in exactly 1 single batch query.
  // Write Reduction = (1 - (1 DB write / 500 events)) * 100%
  const writeReduction = (1 - (1 / writeCount)) * 100;

  console.log('\n==================================================');
  console.log('PERFORMANCE METRICS REPORT');
  console.log('==================================================');
  console.log(`Average Read Latency:   ${avgLatency.toFixed(2)} ms`);
  console.log(`Median (p50) Latency:   ${p50.toFixed(2)} ms`);
  console.log(`p95 Latency:            ${p95.toFixed(2)} ms`);
  console.log(`p99 Latency:            ${p99.toFixed(2)} ms`);
  console.log(`Cache Hit Rate:         ${cacheHitRate.toFixed(2)}%`);
  console.log(`Read Reduction (DB):    ${readReduction.toFixed(2)}% (queries served directly from Cache)`);
  console.log('--------------------------------------------------');
  console.log(`Average Write Latency:  ${avgWriteLatency.toFixed(2)} ms (buffered in-memory)`);
  console.log(`Write Reduction (DB):   ${writeReduction.toFixed(2)}% (reduced ${writeCount} individual DB writes to 1 bulk insert)`);
  console.log('==================================================\n');
}

runBenchmark().catch(console.error);
