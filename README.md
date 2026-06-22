# Search Typeahead System

A high-performance, ultra-low latency Search Typeahead System built using **Express**, **PostgreSQL**, and a distributed caching layer powered by **Redis Consistent Hashing** and a background **Write-Aggregator Buffer**.

---

## Architecture Highlights
* **Consistent Hashing**: Keys are partitioned deterministically across 3 separate Redis instances (`redis-a`, `redis-b`, `redis-c`) to ensure scalable load distribution.
* **Resilient Failover**: Automated database fallback queries prevent service disruption if a Redis cache node goes offline.
* **Write Buffering**: Incoming search submissions write instantly to an in-memory map. A background cron job flushes them to PostgreSQL every 10 seconds via a single bulk-transaction `UPSERT`, reducing database write load by over 99%.
* **Recency-Aware Ranking**: Suggestion ordering blends historical popularity with a tiered, indexing-friendly recency bonus.

---

## Directory Structure
```text
├── public/                  # Frontend client (HTML, CSS, JS)
├── src/
│   ├── api/
│   │   └── routes.ts        # Express routing
│   ├── core/
│   │   ├── db.ts            # PostgreSQL pool and initialization
│   │   └── hashRing.ts      # Consistent Hashing ring configuration
│   ├── models/
│   │   └── search.model.ts  # Database query schemas
│   ├── services/
│   │   └── buffer.service.ts# In-memory batch write aggregator
│   └── server.ts            # Entrypoint and cron schedule
├── benchmark.ts             # Performance measurement script
├── docker-compose.yml       # Dev environment services (Postgres + 3x Redis)
├── seed.ts                  # Dataset ingestion script
└── tsconfig.json            # TypeScript configuration
```

---

## Prerequisites
* **Node.js** (v18 or higher)
* **Docker** & **Docker Compose**

---

## Setup & Running Instructions

### 1. Launch Services
Start the PostgreSQL and Redis containers in the background:
```bash
docker-compose up -d
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Seed Database
Ingest the core query dataset into PostgreSQL (creates schema, sets up indexing, and streams queries in bulk batches):
```bash
npm run seed
```

### 4. Start Development Server
```bash
npm run dev
```
The application will be accessible at: **`http://localhost:3000`**

---

## Performance Benchmarking
A benchmarking utility is included to measure system metrics under simulated load.

Run the benchmark using:
```bash
npx ts-node benchmark.ts
```

This will run 1,000 read requests and 500 search write requests, then output:
* Average, Median, p95, and p99 read latencies
* Cache Hit Rate (%)
* Database Read Load Reduction (%)
* Database Write Load Reduction (%)

---

## Screenshots and Diagrams

### System Architecture Flowchart
![System Architecture](./images/sys_architecture.png)

### Web Interface & Performance Stats
![Search UI](./images/s1.png)

