/** Messages browsers use when a dynamic import (a page chunk or one of its own imports) could not be fetched. */
const chunkFailure = /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS/i;

export const isChunkLoadError = (error: unknown) => error instanceof Error && chunkFailure.test(error.message);

const reloadKey = "yeisme.control.chunk-reload";
const reloadWindowMs = 60_000;

/**
 * Whether a page whose chunk failed may reload by itself. The browser remembers a failed module fetch for the rest of
 * the document's life, so only a reload fetches the chunk again; one reload a minute keeps a chunk that keeps failing
 * on the error screen instead of in a reload loop.
 */
export function mayReloadForChunk(storage: Pick<Storage, "getItem">, now = Date.now()) {
  return now - Number(storage.getItem(reloadKey) || 0) >= reloadWindowMs;
}

/** Records the reload, so a second failure within a minute stays on the error screen. */
export function claimChunkReload(storage: Pick<Storage, "getItem" | "setItem">, now = Date.now()) {
  if (!mayReloadForChunk(storage, now)) return false;
  storage.setItem(reloadKey, String(now));
  return true;
}
