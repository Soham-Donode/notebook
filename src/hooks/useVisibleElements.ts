import { useMemo, useRef, useCallback } from 'react';
import { useNotesStore } from '../store/useNotesStore';
import { CanvasElement, Viewport } from '../types';

/**
 * Viewport culling margin in canvas-space pixels.
 * Elements within this margin of the visible area will be rendered
 * to prevent pop-in during fast panning.
 */
const CULL_MARGIN = 600;

/**
 * Returns the bounding box of an element in canvas-space.
 */
function getElementBounds(el: CanvasElement): { minX: number; minY: number; maxX: number; maxY: number } {
  if (el.type === 'arrow') {
    const offset = Math.abs(el.controlOffset ?? 30);
    return {
      minX: Math.min(el.startX, el.endX) - offset,
      minY: Math.min(el.startY, el.endY) - offset,
      maxX: Math.max(el.startX, el.endX) + offset,
      maxY: Math.max(el.startY, el.endY) + offset,
    };
  }

  const width = ('width' in el && typeof el.width === 'number') ? el.width : 320;
  const height = ('height' in el && typeof el.height === 'number' && el.height !== null) ? el.height : 200;

  return {
    minX: el.x,
    minY: el.y,
    maxX: el.x + width,
    maxY: el.y + height,
  };
}

/**
 * Computes which elements are visible in the current viewport.
 * Uses a generous margin so elements pop in before becoming visible.
 */
function filterVisibleElements(
  elements: CanvasElement[],
  viewport: Viewport,
  containerWidth: number,
  containerHeight: number,
): CanvasElement[] {
  // Convert the screen rectangle to canvas-space
  const viewMinX = (0 - viewport.x) / viewport.zoom - CULL_MARGIN;
  const viewMinY = (0 - viewport.y) / viewport.zoom - CULL_MARGIN;
  const viewMaxX = (containerWidth - viewport.x) / viewport.zoom + CULL_MARGIN;
  const viewMaxY = (containerHeight - viewport.y) / viewport.zoom + CULL_MARGIN;

  return elements.filter((el) => {
    const bounds = getElementBounds(el);
    // AABB intersection: NOT completely outside
    return !(
      bounds.maxX < viewMinX ||
      bounds.minX > viewMaxX ||
      bounds.maxY < viewMinY ||
      bounds.minY > viewMaxY
    );
  });
}

/**
 * Hook that returns only the elements visible in the current viewport.
 * 
 * Designed to avoid re-filtering on every viewport change during smooth pan/zoom.
 * It re-computes the visible set when:
 * - The elements array changes (new element added, deleted, etc.)
 * - The viewport changes significantly (panned more than half the cull margin)
 */
export function useVisibleElements(): CanvasElement[] {
  const activeSection = useNotesStore((state) => {
    const nb = state.notebooks.find((n) => n.id === state.activeNotebookId);
    return nb?.sections.find((s) => s.id === state.activeSectionId);
  });

  const elements = activeSection?.elements ?? [];
  const viewport = activeSection?.viewport ?? { x: 0, y: 0, zoom: 1 };

  // Track the last viewport that triggered a re-filter
  const lastFilterViewport = useRef<Viewport>(viewport);
  const lastFilteredRef = useRef<CanvasElement[]>(elements);
  const lastElementsRef = useRef<CanvasElement[]>(elements);

  // Get container size (cached, updated on significant viewport change)
  const getContainerSize = useCallback(() => {
    const container = document.getElementById('infinite-canvas-container');
    if (container) {
      const rect = container.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    }
    return { width: window.innerWidth - 280, height: window.innerHeight };
  }, []);

  const visible = useMemo(() => {
    const lastVp = lastFilterViewport.current;
    const elementsChanged = elements !== lastElementsRef.current;

    // Check if viewport has moved enough to warrant re-filtering
    // We use half the cull margin as the threshold — this means elements
    // are guaranteed to be pre-loaded before they become visible
    const panDeltaX = Math.abs(viewport.x - lastVp.x) / viewport.zoom;
    const panDeltaY = Math.abs(viewport.y - lastVp.y) / viewport.zoom;
    const zoomChanged = Math.abs(viewport.zoom - lastVp.zoom) > 0.05;
    const panSignificant = panDeltaX > CULL_MARGIN / 2 || panDeltaY > CULL_MARGIN / 2;

    if (!elementsChanged && !panSignificant && !zoomChanged) {
      return lastFilteredRef.current;
    }

    const { width, height } = getContainerSize();
    const filtered = filterVisibleElements(elements, viewport, width, height);

    lastFilterViewport.current = viewport;
    lastElementsRef.current = elements;
    lastFilteredRef.current = filtered;

    return filtered;
  }, [elements, viewport, getContainerSize]);

  return visible;
}
