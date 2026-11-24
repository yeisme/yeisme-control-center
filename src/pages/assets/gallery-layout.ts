/**
 * The works gallery in two layouts: 网格 (equal tiles, the size from the 缩略图大小 slider) and 按比例 (rows of pictures
 * that keep their shape; every row fills the width and the pictures in it share one height).
 */
export type GalleryLayout = "grid" | "justified";

export const ratioRange = { min: 0.5, max: 2.4, fallback: 16 / 10 } as const;

/** A picture's width over height as the owner reported it; 16:10 when it did not, kept between 1:2 and 2.4:1. */
export function tileRatio(width?: number | null, height?: number | null): number {
  if (!width || !height || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return ratioRange.fallback;
  return Math.min(ratioRange.max, Math.max(ratioRange.min, width / height));
}

/** The row height of 按比例 for a tile size: a 16:10 picture there is as wide as a tile of the grid. */
export function rowHeight(tile: number): number {
  return Math.round(tile / ratioRange.fallback);
}

/**
 * One picture's flex sizing in 按比例: it starts at its width for the row height and grows in proportion to its shape,
 * so all pictures in a row end at the same height. A spacer after the last one keeps the last row from stretching.
 */
export function justifiedTile(ratio: number, tile: number): { flexGrow: number; flexBasis: string } {
  return { flexGrow: Number(ratio.toFixed(3)), flexBasis: `${Math.round(ratio * rowHeight(tile))}px` };
}

/** The grid's column rule for a tile size. */
export const gridColumns = (tile: number) => `repeat(auto-fill, minmax(min(${tile}px, 100%), 1fr))`;
