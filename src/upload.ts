/**
 * In-memory upload cache for note.com articles.
 *
 * Design:
 * - Upload results are cached in memory only (per VS Code session).
 *   No files (.note-uploads.json etc.) are written to disk.
 * - note.com copies images to its own CDN on paste, so temporary
 *   hosting URLs only need to survive within the editing session.
 * - SHA-256 hashing deduplicates uploads within the same session.
 * - Expired entries (expiresAt < now) are treated as cache misses
 *   and re-uploaded automatically.
 * - Actual uploads are delegated to ServiceManager (services.ts).
 */

import { createHash } from 'node:crypto';
import { getServiceManager } from './services';
import { normalizeImageRef } from './imageRefs';

const MAX_CACHE_ENTRIES = 200;
export const UPLOAD_DELAY_MS = 2000;

export interface UploadResult {
  fileName: string;
  url: string;
  sha256: string;
  /** Whether the result came from cache (no network upload). */
  cached: boolean;
  /** Name of the service that handled the upload (or served the cache). */
  serviceName?: string;
}

/** Single entry in the upload cache — keyed by source SHA-256. */
export interface CacheEntry {
  url: string;
  /** Original source refs used in markdown (for preview / copy URL replacement) */
  sourceRefs: string[];
  /** Upload timestamp (ms since epoch) for LRU eviction */
  uploadedAt: number;
  /** Epoch ms when the URL is expected to expire. null = permanent. */
  expiresAt: number | null;
  /** Which upload service was used */
  serviceName: string;
}

/** hash → CacheEntry */
type CacheMap = Record<string, CacheEntry>;

/** Flat sourceRef→URL map consumed by preview / copy. */
export type UrlMap = Record<string, string>;

export function sha256(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

export function rememberSourceRef(entry: CacheEntry, sourceRef: string): void {
  const normalized = normalizeImageRef(sourceRef);
  if (!entry.sourceRefs.includes(normalized)) {
    entry.sourceRefs.push(normalized);
  }
}

// ---------------------------------------------------------------------------
// In-memory cache (per article directory)
// ---------------------------------------------------------------------------

const sessionCache = new Map<string, CacheMap>();

/** Clear all upload caches — call from extension deactivate(). */
export function resetUploadCache(): void {
  sessionCache.clear();
  urlMapSnapshots.clear();
}

export function loadRegistry(articleDir: string): CacheMap {
  let cache = sessionCache.get(articleDir);
  if (!cache) {
    cache = {};
    sessionCache.set(articleDir, cache);
  }
  return cache;
}

export function saveRegistry(_articleDir: string, cache: CacheMap): void {
  const now = Date.now();

  // Purge expired entries
  for (const [hash, entry] of Object.entries(cache)) {
    if (entry.expiresAt !== null && entry.expiresAt < now) {
      delete cache[hash];
    }
  }

  // Evict oldest entries beyond the cap
  const keys = Object.keys(cache);
  if (keys.length > MAX_CACHE_ENTRIES) {
    const sorted = keys.sort((a, b) => (cache[a].uploadedAt ?? 0) - (cache[b].uploadedAt ?? 0));
    for (const k of sorted.slice(0, keys.length - MAX_CACHE_ENTRIES)) {
      delete cache[k];
    }
  }
}

// ---------------------------------------------------------------------------
// Cache-aware upload (with expiry check)
// ---------------------------------------------------------------------------

/**
 * Upload a file, consulting the in-memory cache to skip if unchanged
 * AND not expired.  Cache is mutated in-place (caller calls saveRegistry
 * to prune).
 */
export async function uploadWithRegistry(
  data: Buffer,
  fileName: string,
  sourceRef: string,
  cache: CacheMap,
  expiry = '72h',
  force = false,
): Promise<UploadResult> {
  const hash = sha256(data);
  const now = Date.now();

  // Reuse only if entry exists AND has not expired (unless forced)
  const existing = cache[hash];
  if (existing && !force) {
    const expired = existing.expiresAt !== null && existing.expiresAt < now;
    if (!expired) {
      rememberSourceRef(existing, sourceRef);
      return {
        fileName,
        url: existing.url,
        sha256: hash,
        cached: true,
        serviceName: existing.serviceName,
      };
    }
    delete cache[hash];
  }

  // Upload via ServiceManager (handles health check + fallback)
  const mgr = getServiceManager();
  const outcome = await mgr.upload(data, fileName, expiry);

  cache[hash] = {
    url: outcome.url,
    sourceRefs: [normalizeImageRef(sourceRef)],
    uploadedAt: now,
    expiresAt: outcome.expiresAt,
    serviceName: outcome.serviceName,
  };

  return {
    fileName,
    url: outcome.url,
    sha256: hash,
    cached: false,
    serviceName: outcome.serviceName,
  };
}

// ---------------------------------------------------------------------------
// URL map from cache (expiry-aware, with short-lived materialized cache)
// ---------------------------------------------------------------------------

interface UrlMapSnapshot {
  urlMap: UrlMap;
  cacheSize: number;
  builtAt: number;
}

const urlMapSnapshots = new Map<string, UrlMapSnapshot>();
const URL_MAP_TTL_MS = 1000;

/**
 * Build a flat sourceRef→URL map from the in-memory cache.
 * Expired entries are silently skipped.
 * Results are cached for up to 1 second to avoid repeated iteration
 * on every keystroke.
 */
export function loadUrlMap(articleDir: string): UrlMap | null {
  const cache = loadRegistry(articleDir);
  const cacheSize = Object.keys(cache).length;
  const now = Date.now();

  const snap = urlMapSnapshots.get(articleDir);
  if (snap && snap.cacheSize === cacheSize && now - snap.builtAt < URL_MAP_TTL_MS) {
    return Object.keys(snap.urlMap).length === 0 ? null : snap.urlMap;
  }

  const out: UrlMap = {};
  for (const entry of Object.values(cache)) {
    if (entry.expiresAt !== null && entry.expiresAt < now) continue;
    for (const sourceRef of entry.sourceRefs) {
      out[sourceRef] = entry.url;
    }
  }

  urlMapSnapshots.set(articleDir, { urlMap: out, cacheSize, builtAt: now });
  return Object.keys(out).length === 0 ? null : out;
}
