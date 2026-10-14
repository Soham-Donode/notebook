import type { Viewport } from '../types';

export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 3.0;
export const GRID_BASE_SPACING = 28;

export function clamp(val: number, min: number, max: number): number {
  return Math.min(Math.max(val, min), max);
}

/**
 * Screen (container-relative px) to canvas space
 * §8.1: canvasX = (screenX - viewport.x) / viewport.zoom
 */
export function screenToCanvas(
  clientX: number,
  clientY: number,
  viewport: Viewport,
  containerRect: { left: number; top: number }
): { x: number; y: number } {
  const screenX = clientX - containerRect.left;
  const screenY = clientY - containerRect.top;
  return {
    x: (screenX - viewport.x) / viewport.zoom,
    y: (screenY - viewport.y) / viewport.zoom,
  };
}

/**
 * Canvas space to screen space (container-relative)
 * §8.1: screenX = canvasX * viewport.zoom + viewport.x
 */
export function canvasToScreen(
  canvasX: number,
  canvasY: number,
  viewport: Viewport,
  containerRect: { left: number; top: number }
): { x: number; y: number } {
  return {
    x: canvasX * viewport.zoom + viewport.x + containerRect.left,
    y: canvasY * viewport.zoom + viewport.y + containerRect.top,
  };
}

/**
 * Zoom anchored to cursor
 * §8.2 formula:
 * const next = clamp(zoom * Math.exp(-deltaY * 0.01), 0.25, 3);
 * const k = next / zoom;
 * viewport.x = px - k * (px - viewport.x);
 * viewport.y = py - k * (py - viewport.y);
 * viewport.zoom = next;
 */
export function calculateCursorZoom(
  px: number,
  py: number,
  deltaY: number,
  viewport: Viewport
): Viewport {
  const nextZoom = clamp(viewport.zoom * Math.exp(-deltaY * 0.01), MIN_ZOOM, MAX_ZOOM);
  if (nextZoom === viewport.zoom) return viewport;

  const k = nextZoom / viewport.zoom;
  return {
    x: px - k * (px - viewport.x),
    y: py - k * (py - viewport.y),
    zoom: nextZoom,
  };
}

/**
 * Zoom anchored to a specific container point (e.g. center of viewport)
 */
export function calculateTargetZoom(
  anchorX: number,
  anchorY: number,
  targetZoom: number,
  viewport: Viewport
): Viewport {
  const nextZoom = clamp(targetZoom, MIN_ZOOM, MAX_ZOOM);
  if (nextZoom === viewport.zoom) return viewport;

  const k = nextZoom / viewport.zoom;
  return {
    x: anchorX - k * (anchorX - viewport.x),
    y: anchorY - k * (anchorY - viewport.y),
    zoom: nextZoom,
  };
}

/**
 * Dot grid style on static container
 * §8.3:
 * const spacing = 28 * zoom;
 * style = {
 *   backgroundImage: `radial-gradient(circle, var(--color-dot) ${Math.max(0.6, 1.2 * zoom)}px, transparent ${Math.max(0.6, 1.2 * zoom)}px)`,
 *   backgroundSize: `${spacing}px ${spacing}px`,
 *   backgroundPosition: `${viewport.x % spacing}px ${viewport.y % spacing}px`,
 * };
 */
export function getDotGridStyle(viewport: Viewport): React.CSSProperties {
  const spacing = GRID_BASE_SPACING * viewport.zoom;
  const dotSize = Math.max(0.6, 1.2 * viewport.zoom);
  const posX = ((viewport.x % spacing) + spacing) % spacing;
  const posY = ((viewport.y % spacing) + spacing) % spacing;

  return {
    backgroundImage: `radial-gradient(circle, var(--color-dot) ${dotSize}px, transparent ${dotSize}px)`,
    backgroundSize: `${spacing}px ${spacing}px`,
    backgroundPosition: `${posX}px ${posY}px`,
  };
}
