import type { CanvasElement, Viewport } from '../types';
import { captureCanvasRegion } from './captureRegion';
import { useAiStore } from '../store/aiStore';
import { useUiStore } from '../store/useUiStore';

export interface CanvasBBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Axis-aligned bounding box over elements (same geometry the marquee uses). */
export function getElementsBBox(elements: CanvasElement[]): CanvasBBox | null {
  if (elements.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const el of elements) {
    let elMinX = el.x;
    let elMaxX = el.x + ('width' in el && typeof el.width === 'number' ? el.width : 200);
    let elMinY = el.y;
    let elMaxY = el.y + ('height' in el && typeof el.height === 'number' && el.height !== null ? el.height : 60);

    // Arrows bulge out from the chord — pad with the control offset.
    if (el.type === 'arrow') {
      const chordMinX = Math.min(el.startX, el.endX);
      const chordMaxX = Math.max(el.startX, el.endX);
      const chordMinY = Math.min(el.startY, el.endY);
      const chordMaxY = Math.max(el.startY, el.endY);
      const offset = Math.abs(el.controlOffset ?? 30);
      elMinX = chordMinX - offset;
      elMaxX = chordMaxX + offset;
      elMinY = chordMinY - offset;
      elMaxY = chordMaxY + offset;
    }

    minX = Math.min(minX, elMinX);
    minY = Math.min(minY, elMinY);
    maxX = Math.max(maxX, elMaxX);
    maxY = Math.max(maxY, elMaxY);
  }

  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };
}

/**
 * Captures a canvas region, creates a new AI thread from it, opens the
 * sidebar and optionally fires the first question right away.
 * Resolves with the new thread id.
 */
export async function sendCanvasRegionToAI(params: {
  container: HTMLElement;
  region: CanvasBBox;
  viewport: Viewport;
  firstMessage?: string;
}): Promise<string> {
  const { container, region, viewport, firstMessage } = params;

  const shot = await captureCanvasRegion(container, region, viewport);
  const threadId = await useAiStore.getState().startThreadFromCapture(shot.blob, shot.width, shot.height);
  const ai = useAiStore.getState();
  ai.setActiveThread(threadId);
  useUiStore.getState().setAiSidebarOpen(true);
  if (firstMessage && firstMessage.trim()) {
    void ai.sendMessage(threadId, firstMessage);
  }
  return threadId;
}
