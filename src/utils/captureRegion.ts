import type { Viewport } from '../types';

export interface CaptureRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  // Canvas-space coordinates (same space as element geometry).
}

export interface CapturedImage {
  blob: Blob; // JPEG, long edge ≤ 1600px — sized well for vision models
  width: number;
  height: number;
}

const TARGET_LONG_EDGE = 1600;
const JPEG_QUALITY = 0.85;

/**
 * Rasterizes a rectangular canvas region to an image blob.
 *
 * Renders the live `#infinite-canvas-container` DOM with html2canvas-pro at a
 * resolution that compensates for the current zoom, then crops the region and
 * downscales to a shared long edge. Overlays inside the container must be
 * tagged with `data-ai-capture-hide` — those are removed from the clone before
 * rendering, so the capture shows exactly what the user sees.
 */
export async function captureCanvasRegion(
  container: HTMLElement,
  region: CaptureRegion,
  viewport: Viewport
): Promise<CapturedImage> {
  const containerRect = container.getBoundingClientRect();

  // Canvas → container-relative screen space (translate + uniform scale only).
  const sx = region.x * viewport.zoom + viewport.x;
  const sy = region.y * viewport.zoom + viewport.y;
  const sw = region.width * viewport.zoom;
  const sh = region.height * viewport.zoom;

  // A screenshot is WYSIWYG: capture what is visible inside the container.
  const cx0 = Math.max(0, sx);
  const cy0 = Math.max(0, sy);
  const cx1 = Math.min(containerRect.width, sx + sw);
  const cy1 = Math.min(containerRect.height, sy + sh);
  if (cx1 - cx0 < 8 || cy1 - cy0 < 8) {
    throw new Error('Capture region is outside the visible canvas.');
  }

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const scale = Math.min(4, (1.4 / viewport.zoom) * dpr);

  const html2canvas = (await import('html2canvas-pro')).default;
  const capture = await html2canvas(container, {
    backgroundColor: null,
    logging: false,
    scale,
    onclone: (doc) => {
      doc.querySelectorAll('[data-ai-capture-hide]').forEach((el) => el.remove());
    },
  });
  if (!capture || capture.width === 0 || capture.height === 0) {
    throw new Error('Could not rasterize the canvas.');
  }

  // Map crop coords through the real capture dimensions (guards rounding drift).
  const relX = capture.width / containerRect.width;
  const relY = capture.height / containerRect.height;
  const cropX = Math.round(cx0 * relX);
  const cropY = Math.round(cy0 * relY);
  const cropW = Math.max(1, Math.round((cx1 - cx0) * relX));
  const cropH = Math.max(1, Math.round((cy1 - cy0) * relY));

  const longEdge = Math.max(cropW, cropH);
  const outScale = Math.min(1, TARGET_LONG_EDGE / longEdge);
  const outW = Math.max(1, Math.round(cropW * outScale));
  const outH = Math.max(1, Math.round(cropH * outScale));

  const out = document.createElement('canvas');
  out.width = outW;
  out.height = outH;
  const ctx = out.getContext('2d');
  if (!ctx) throw new Error('Could not allocate the capture canvas.');

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, outW, outH);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(capture, cropX, cropY, cropW, cropH, 0, 0, outW, outH);

  const blob = await new Promise<Blob | null>((resolve) =>
    out.toBlob(resolve, 'image/jpeg', JPEG_QUALITY)
  );
  if (!blob) throw new Error('Could not encode the screenshot.');

  return { blob, width: outW, height: outH };
}
