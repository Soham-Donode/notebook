/**
 * Imported documents (PDF, Word, PowerPoint) are normalized to one card width so
 * pages look consistent on the canvas. Height follows the page's own aspect
 * ratio, clamped to a fixed range so unusual page shapes stay usable.
 */
export const PAGE_CARD_WIDTH = 800;

/** Allowed height/width ratio for an imported page (≈440px to ≈1320px tall). */
export const MIN_PAGE_ASPECT = 0.55;
export const MAX_PAGE_ASPECT = 1.65;

/** Rasterization target: 2x the card width for crisp rendering on retina screens. */
export const PAGE_IMAGE_WIDTH = PAGE_CARD_WIDTH * 2;

/** Cap image height so very long pages don't consume excessive memory. */
export const PAGE_IMAGE_MAX_HEIGHT = 2600;

export interface PageCardSize {
  width: number;
  height: number;
}

/** Convert a page's natural size into the normalized canvas card size. */
export function normalizePageSize(naturalWidth: number, naturalHeight: number): PageCardSize {
  const width = naturalWidth > 0 ? naturalWidth : 1;
  const height = naturalHeight > 0 ? naturalHeight : 1;
  const aspect = Math.min(MAX_PAGE_ASPECT, Math.max(MIN_PAGE_ASPECT, height / width));

  return {
    width: PAGE_CARD_WIDTH,
    height: Math.round(PAGE_CARD_WIDTH * aspect),
  };
}

/**
 * Scale factor to rasterize a page of the given natural size. Produces images
 * roughly PAGE_IMAGE_WIDTH wide, shrinking further if that would exceed the
 * maximum image height.
 */
export function getPageRasterScale(naturalWidth: number, naturalHeight: number): number {
  const width = naturalWidth > 0 ? naturalWidth : 1;
  const height = naturalHeight > 0 ? naturalHeight : 1;

  const widthScale = PAGE_IMAGE_WIDTH / width;
  if (height * widthScale <= PAGE_IMAGE_MAX_HEIGHT) {
    return widthScale;
  }
  return PAGE_IMAGE_MAX_HEIGHT / height;
}
