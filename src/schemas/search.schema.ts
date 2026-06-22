export interface SearchRequest {
  query: string;
}

export interface CacheDebugResponse {
  prefix: string;
  cacheKey: string;
  node: string;
  hit: boolean;
}
