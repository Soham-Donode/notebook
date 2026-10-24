import { memo, useCallback } from 'react';
import { useNotesStore } from '../../store/useNotesStore';
import { useVisibleElements } from '../../hooks/useVisibleElements';
import { screenToCanvas } from '../../utils/canvasMath';
import { TextCard } from './TextCard';
import { PdfPageCard } from './PdfPageCard';
import { ImageCard } from './ImageCard';
import { ArrowCard } from './ArrowCard';

interface CanvasElementsProps {
  onDoubleClickCanvas?: (canvasX: number, canvasY: number) => void;
}

/**
 * Memoized component that renders all visible canvas elements.
 * 
 * This component subscribes to elements via useVisibleElements (which has
 * built-in viewport culling and hysteresis), and is memo-wrapped so that
 * viewport-only changes in the parent Canvas component do NOT cause
 * re-renders of any element cards.
 */
const CanvasElementsInner = ({ onDoubleClickCanvas }: CanvasElementsProps) => {
  const visibleElements = useVisibleElements();

  // Stable callback for locked PDF/Image double-click → create text at click point
  const handleDoubleClickLocked = useCallback(
    (clientX: number, clientY: number) => {
      const state = useNotesStore.getState();
      const nb = state.notebooks.find((n) => n.id === state.activeNotebookId);
      const section = nb?.sections.find((s) => s.id === state.activeSectionId);
      if (!section) return;

      const rect = document.getElementById('infinite-canvas-container')?.getBoundingClientRect();
      if (!rect) return;

      const coords = screenToCanvas(clientX, clientY, section.viewport, rect);
      onDoubleClickCanvas?.(coords.x, coords.y);
    },
    [onDoubleClickCanvas]
  );

  return (
    <>
      {visibleElements.map((el) => {
        if (el.type === 'text') {
          return <TextCard key={el.id} element={el} />;
        }
        if (el.type === 'pdf-page') {
          return (
            <PdfPageCard
              key={el.id}
              element={el}
              onDoubleClickLocked={handleDoubleClickLocked}
            />
          );
        }
        if (el.type === 'image') {
          return (
            <ImageCard
              key={el.id}
              element={el}
              onDoubleClickLocked={handleDoubleClickLocked}
            />
          );
        }
        if (el.type === 'arrow') {
          return <ArrowCard key={el.id} element={el} />;
        }
        return null;
      })}
    </>
  );
};

export const CanvasElements = memo(CanvasElementsInner);
