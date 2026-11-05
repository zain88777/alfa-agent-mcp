import { loadRuntimeConfig } from "./runtimeConfig.js";

export interface CacheEntry {
  key: string;
  value: unknown;
  createdAt: number;
  expiresAt: number;
  toolName: string;
  workspaceRoot: string;
}

export interface CacheMetrics {
  hits: number;
  misses: number;
  evictions: number;
  invalidations: number;
}

export interface CacheSnapshot {
  entries: number;
  maxEntries: number;
  ttlMs: number;
  hitRatio: number;
  metrics: CacheMetrics;
}

const DEFAULT_MAX_ENTRIES = 200;
const DEFAULT_TTL_MS = 30_000;

function stableStringify(input: unknown): string {
  if (input === null || typeof input !== "object") return JSON.stringify(input);
  if (Array.isArray(input)) return `[${input.map(stableStringify).join(",")}]`;
  const obj = input as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

export class CacheEngine {
  private lru = new Map<string, CacheEntry>();
  private metrics: CacheMetrics = { hits: 0, misses: 0, evictions: 0, invalidations: 0 };

  private readonly maxEntries: number;
  private readonly ttlMs: number;

  constructor(maxEntries: number = DEFAULT_MAX_ENTRIES, ttlMs: number = DEFAULT_TTL_MS) {
    this.maxEntries = maxEntries;
    this.ttlMs = ttlMs;
  }

  makeKey(toolName: string, input: unknown, workspaceRoot?: string): string {
    const root = workspaceRoot ?? loadRuntimeConfig().workspaceRoot;
    return `${root}::${toolName}::${stableStringify(input)}`;
  }

  get(key: string): unknown | undefined {
    const entry = this.lru.get(key);
    if (!entry) {
      this.metrics.misses++;
      return undefined;
    }
    if (entry.expiresAt <= Date.now()) {
      this.lru.delete(key);
      this.metrics.misses++;
      return undefined;
    }
    this.lru.delete(key);
    this.lru.set(key, entry);
    this.metrics.hits++;
    return entry.value;
  }

  set(key: string, value: unknown, toolName: string, workspaceRoot?: string): void {
    const root = workspaceRoot ?? loadRuntimeConfig().workspaceRoot;
    if (this.lru.has(key)) {
      this.lru.delete(key);
    }
    this.lru.set(key, {
      key,
      value,
      toolName,
      workspaceRoot: root,
      createdAt: Date.now(),
      expiresAt: Date.now() + this.ttlMs,
    });
    while (this.lru.size > this.maxEntries) {
      const oldest = this.lru.keys().next().value as string | undefined;
      if (!oldest) break;
      this.lru.delete(oldest);
      this.metrics.evictions++;
    }
  }

  invalidate(predicate: (entry: CacheEntry) => boolean): number {
    let removed = 0;
    for (const [k, v] of this.lru.entries()) {
      if (predicate(v)) {
        this.lru.delete(k);
        removed++;
      }
    }
    if (removed > 0) this.metrics.invalidations += removed;
    return removed;
  }

  invalidateTools(toolNames: string[]): number {
    const set = new Set(toolNames);
    return this.invalidate((e) => set.has(e.toolName));
  }

  invalidateWorkspace(workspaceRoot: string): number {
    return this.invalidate((e) => e.workspaceRoot === workspaceRoot);
  }

  reset(): void {
    this.lru.clear();
    this.metrics = { hits: 0, misses: 0, evictions: 0, invalidations: 0 };
  }

  snapshot(): CacheSnapshot {
    const totalLookups = this.metrics.hits + this.metrics.misses;
    return {
      entries: this.lru.size,
      maxEntries: this.maxEntries,
      ttlMs: this.ttlMs,
      hitRatio: totalLookups === 0 ? 0 : this.metrics.hits / totalLookups,
      metrics: { ...this.metrics },
    };
  }

  entryCount(): number {
    return this.lru.size;
  }
}

export const globalCacheEngine = new CacheEngine();
