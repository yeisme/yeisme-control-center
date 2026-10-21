export interface MediaCacheValue {
  url: string;
  bytes: number;
  mime: string;
  expiresAt: number;
}

interface Entry extends MediaCacheValue {
  key: string;
  lastUsed: number;
}

interface MediaCacheOptions {
  maxEntries?: number;
  maxBytes?: number;
  createObjectURL?: (blob: Blob) => string;
  revokeObjectURL?: (url: string) => void;
}

/** Session-only media bytes. It never writes to disk and is scoped by the caller's identity key. */
export class MediaSessionCache {
  private entries = new Map<string, Entry>();
  private pending = new Map<string, Promise<MediaCacheValue | null>>();
  private totalBytes = 0;
  private identity = "";
  private readonly maxEntries: number;
  private readonly maxBytes: number;
  private readonly createObjectURL: (blob: Blob) => string;
  private readonly revokeObjectURL: (url: string) => void;

  constructor(options: MediaCacheOptions = {}) {
    this.maxEntries = options.maxEntries ?? 8;
    this.maxBytes = options.maxBytes ?? 64 * 1024 * 1024;
    this.createObjectURL = options.createObjectURL ?? ((blob) => URL.createObjectURL(blob));
    this.revokeObjectURL = options.revokeObjectURL ?? ((url) => URL.revokeObjectURL(url));
  }

  setIdentity(identity: string) {
    if (this.identity && this.identity !== identity) this.clear();
    this.identity = identity;
  }

  get(key: string, now = Date.now()): MediaCacheValue | null {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= now) {
      this.remove(key);
      return null;
    }
    entry.lastUsed = now;
    return { url: entry.url, bytes: entry.bytes, mime: entry.mime, expiresAt: entry.expiresAt };
  }

  async load(
    key: string,
    loader: () => Promise<{ blob: Blob; expiresAt: number }>,
  ): Promise<MediaCacheValue | null> {
    const cached = this.get(key);
    if (cached) return cached;
    const running = this.pending.get(key);
    if (running) return running;
    const pending = loader().then(({ blob, expiresAt }) => {
      if (!blob.size || expiresAt <= Date.now() || blob.size > this.maxBytes) return null;
      const value: Entry = {
        key,
        url: this.createObjectURL(blob),
        bytes: blob.size,
        mime: blob.type,
        expiresAt,
        lastUsed: Date.now(),
      };
      this.remove(key);
      this.entries.set(key, value);
      this.totalBytes += value.bytes;
      this.evict();
      return { url: value.url, bytes: value.bytes, mime: value.mime, expiresAt: value.expiresAt };
    }).finally(() => {
      if (this.pending.get(key) === pending) this.pending.delete(key);
    });
    this.pending.set(key, pending);
    return pending;
  }

  remove(key: string) {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    this.totalBytes -= entry.bytes;
    this.revokeObjectURL(entry.url);
  }

  clear() {
    for (const entry of this.entries.values()) this.revokeObjectURL(entry.url);
    this.entries.clear();
    this.totalBytes = 0;
  }

  private evict() {
    while (this.entries.size > this.maxEntries || this.totalBytes > this.maxBytes) {
      const oldest = [...this.entries.values()].sort((a, b) => a.lastUsed - b.lastUsed)[0];
      if (!oldest) return;
      this.remove(oldest.key);
    }
  }
}

export const mediaSessionCache = new MediaSessionCache();

export function mediaCacheKey(scope: string, epoch: number | undefined, task: string, artifact: string, mime: string) {
  return [scope, epoch || 0, task, artifact, mime].join("|");
}
