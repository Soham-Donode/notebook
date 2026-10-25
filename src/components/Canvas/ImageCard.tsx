import {
  type FC,
  memo,
  useRef,
  useState,
  useEffect,
  useCallback,
} from 'react';
import { Lock } from 'lucide-react';
import { ImageElement } from '../../types';
import { useNotesStore } from '../../store/useNotesStore';
import { useUiStore } from '../../store/useUiStore';
import { getPageImageUrl } from '../../store/imageStore';
import { ElementQuickActions } from './ElementQuickActions';

interface ImageCardProps {
  element: ImageElement;
  onDoubleClickLocked?: (clientX: number, clientY: number) => void;
}

const ImageCardInner: FC<ImageCardProps> = ({ element, onDoubleClickLocked }) => {
  const cardRef = useRef<HTMLDivElement>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  // Store actions
  const moveElement = useNotesStore((state) => state.moveElement);
  const moveElements = useNotesStore((state) => state.moveElements);
  const updateElement = useNotesStore((state) => state.updateElement);

  // UI state
  const selectedId = useUiStore((state) => state.selectedId);
  const selectedIds = useUiStore((state) => state.selectedIds);
  const setSelectedId = useUiStore((state) => state.setSelectedId);
  const activeTool = useUiStore((state) => state.activeTool);

  const isSelected = selectedId === element.id || selectedIds.includes(element.id);

  // Drag interaction refs
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef<{
    clientX: number;
    clientY: number;
    elX: number;
    elY: number;
    draggedIds: string[];
    startPositions: Record<string, { type: string; x: number; y: number }>;
  } | null>(null);

  // Resize interaction refs
  const isResizingRef = useRef(false);
  const resizeStartRef = useRef<{
    clientX: number;
    clientY: number;
    startWidth: number;
    startHeight: number;
    startX: number;
    startY: number;
    handle: 'se' | 'sw' | 'ne' | 'nw';
  } | null>(null);
  const currentDimensionsRef = useRef({ width: element.width, height: element.height });

  useEffect(() => {
    if (!isResizingRef.current) {
      currentDimensionsRef.current = { width: element.width, height: element.height };
      if (cardRef.current) {
        cardRef.current.style.width = `${element.width}px`;
        cardRef.current.style.height = `${element.height}px`;
      }
    }
  }, [element.width, element.height]);

  // Fetch memoized object URL from IDB
  useEffect(() => {
    let isCancelled = false;
    getPageImageUrl(element.imageKey).then((url) => {
      if (!isCancelled && url) {
        setImageUrl(url);
      }
    });
    return () => {
      isCancelled = true;
    };
  }, [element.imageKey]);

  // Pointer drag for moving the card (P7/P8: read current zoom dynamically)
  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.closest('button') ||
        target.closest('[data-control-bar]') ||
        target.closest('[data-lock-badge]') ||
        target.closest('[data-resize-handle]')
      ) {
        if (activeTool !== 'select') return;
        e.stopPropagation();
        return;
      }

      if (activeTool !== 'select') return;

      if (element.isLocked) {
        if (e.button === 0) {
          e.stopPropagation();
          setSelectedId(element.id);
        }
        return;
      }

      e.stopPropagation();
      const { selectedIds, selectedId } = useUiStore.getState();
      const isPartOfMultiSelect = selectedIds.includes(element.id) && selectedIds.length > 1;

      if (!isPartOfMultiSelect && selectedId !== element.id) {
        setSelectedId(element.id);
      }

      e.currentTarget.setPointerCapture(e.pointerId);
      isDraggingRef.current = true;

      const state = useNotesStore.getState();
      const currentNb = state.notebooks.find((nb) => nb.id === state.activeNotebookId);
      const currentSec = currentNb?.sections.find((s) => s.id === state.activeSectionId);

      const draggedIds = isPartOfMultiSelect ? selectedIds : [element.id];
      const startPositions: Record<string, { type: string; x: number; y: number }> = {};

      for (const id of draggedIds) {
        const el = currentSec?.elements.find((item) => item.id === id);
        if (el) {
          startPositions[id] = { type: el.type, x: el.x, y: el.y };
        }
      }

      dragStartRef.current = {
        clientX: e.clientX,
        clientY: e.clientY,
        elX: element.x,
        elY: element.y,
        draggedIds,
        startPositions,
      };
    },
    [element.id, element.isLocked, element.x, element.y, setSelectedId, activeTool]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isDraggingRef.current || !dragStartRef.current) return;

      const state = useNotesStore.getState();
      const currentNb = state.notebooks.find((nb) => nb.id === state.activeNotebookId);
      const currentSec = currentNb?.sections.find((s) => s.id === state.activeSectionId);
      const currentZoom = currentSec?.viewport.zoom ?? 1;

      const dx = (e.clientX - dragStartRef.current.clientX) / currentZoom;
      const dy = (e.clientY - dragStartRef.current.clientY) / currentZoom;

      const draggedIds = dragStartRef.current.draggedIds;
      for (const id of draggedIds) {
        const orig = dragStartRef.current.startPositions[id];
        if (orig) {
          const nextX = orig.x + dx;
          const nextY = orig.y + dy;
          const node = document.querySelector<HTMLElement>(`[data-element-id="${id}"]`);
          if (node) {
            if (orig.type === 'arrow') {
              node.style.transform = `translate(${dx}px, ${dy}px)`;
            } else {
              node.style.transform = `translate(${nextX}px, ${nextY}px)`;
            }
          }
        }
      }
    },
    []
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (isDraggingRef.current && dragStartRef.current) {
        try {
          e.currentTarget.releasePointerCapture(e.pointerId);
        } catch {
          // pointer may already be released
        }
        isDraggingRef.current = false;

        const state = useNotesStore.getState();
        const currentNb = state.notebooks.find((nb) => nb.id === state.activeNotebookId);
        const currentSec = currentNb?.sections.find((s) => s.id === state.activeSectionId);
        const currentZoom = currentSec?.viewport.zoom ?? 1;

        const dx = (e.clientX - dragStartRef.current.clientX) / currentZoom;
        const dy = (e.clientY - dragStartRef.current.clientY) / currentZoom;
        const draggedIds = dragStartRef.current.draggedIds;
        const startPositions = dragStartRef.current.startPositions;
        dragStartRef.current = null;

        // Clear temporary CSS transform on all dragged arrows so SVG paths take over at new coords
        for (const id of draggedIds) {
          const orig = startPositions[id];
          if (orig?.type === 'arrow') {
            const node = document.querySelector<HTMLElement>(`[data-element-id="${id}"]`);
            if (node) {
              node.style.transform = '';
            }
          }
        }

        if (draggedIds.length > 1) {
          moveElements(draggedIds, dx, dy, true);
        } else {
          moveElement(element.id, element.x + dx, element.y + dy, true);
        }
      }
    },
    [element.id, element.x, element.y, moveElement, moveElements]
  );

  // Resize pointer handlers
  const handleResizePointerDown = (
    e: React.PointerEvent,
    handle: 'se' | 'sw' | 'ne' | 'nw'
  ) => {
    if (element.isLocked || activeTool !== 'select') return;
    e.stopPropagation();
    e.preventDefault();
    if (e.button !== 0) return;

    e.currentTarget.setPointerCapture(e.pointerId);
    isResizingRef.current = true;
    resizeStartRef.current = {
      clientX: e.clientX,
      clientY: e.clientY,
      startWidth: currentDimensionsRef.current.width,
      startHeight: currentDimensionsRef.current.height,
      startX: element.x,
      startY: element.y,
      handle,
    };
  };

  const handleResizePointerMove = (e: React.PointerEvent) => {
    if (!isResizingRef.current || !resizeStartRef.current) return;
    e.stopPropagation();

    const state = useNotesStore.getState();
    const currentNb = state.notebooks.find((nb) => nb.id === state.activeNotebookId);
    const currentSec = currentNb?.sections.find((s) => s.id === state.activeSectionId);
    const zoom = currentSec?.viewport.zoom ?? 1;

    const start = resizeStartRef.current;
    const dx = (e.clientX - start.clientX) / zoom;
    const aspectRatio = Math.max(0.1, start.startWidth / start.startHeight);

    let nextWidth = start.startWidth;
    let nextHeight = start.startHeight;

    if (start.handle === 'se') {
      nextWidth = Math.max(80, Math.round(start.startWidth + dx));
      nextHeight = Math.max(60, Math.round(nextWidth / aspectRatio));
    } else if (start.handle === 'sw') {
      nextWidth = Math.max(80, Math.round(start.startWidth - dx));
      nextHeight = Math.max(60, Math.round(nextWidth / aspectRatio));
      const nextX = start.startX - (nextWidth - start.startWidth);
      if (cardRef.current) {
        cardRef.current.style.transform = `translate(${nextX}px, ${start.startY}px)`;
      }
    } else if (start.handle === 'ne') {
      nextWidth = Math.max(80, Math.round(start.startWidth + dx));
      nextHeight = Math.max(60, Math.round(nextWidth / aspectRatio));
      const nextY = start.startY - (nextHeight - start.startHeight);
      if (cardRef.current) {
        cardRef.current.style.transform = `translate(${start.startX}px, ${nextY}px)`;
      }
    } else if (start.handle === 'nw') {
      nextWidth = Math.max(80, Math.round(start.startWidth - dx));
      nextHeight = Math.max(60, Math.round(nextWidth / aspectRatio));
      const nextX = start.startX - (nextWidth - start.startWidth);
      const nextY = start.startY - (nextHeight - start.startHeight);
      if (cardRef.current) {
        cardRef.current.style.transform = `translate(${nextX}px, ${nextY}px)`;
      }
    }

    currentDimensionsRef.current = { width: nextWidth, height: nextHeight };
    if (cardRef.current) {
      cardRef.current.style.width = `${nextWidth}px`;
      cardRef.current.style.height = `${nextHeight}px`;
    }
  };

  const handleResizePointerUp = (e: React.PointerEvent) => {
    if (isResizingRef.current) {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // Ignored
      }
      const start = resizeStartRef.current;
      isResizingRef.current = false;
      resizeStartRef.current = null;

      if (start && (start.handle === 'sw' || start.handle === 'ne' || start.handle === 'nw')) {
        const finalWidth = currentDimensionsRef.current.width;
        const finalHeight = currentDimensionsRef.current.height;
        let finalX = start.startX;
        let finalY = start.startY;

        if (start.handle === 'sw') {
          finalX = start.startX - (finalWidth - start.startWidth);
        } else if (start.handle === 'ne') {
          finalY = start.startY - (finalHeight - start.startHeight);
        } else if (start.handle === 'nw') {
          finalX = start.startX - (finalWidth - start.startWidth);
          finalY = start.startY - (finalHeight - start.startHeight);
        }

        moveElement(element.id, finalX, finalY, false);
      }

      updateElement(
        element.id,
        {
          width: currentDimensionsRef.current.width,
          height: currentDimensionsRef.current.height,
        },
        true
      );
    }
  };

  return (
    <div
      ref={cardRef}
      id={`image-card-${element.id}`}
      data-element-id={element.id}
      onClick={(e) => {
        if (activeTool !== 'select') return;
        e.stopPropagation();
        setSelectedId(element.id);
      }}
      onDoubleClick={(e) => {
        if (element.isLocked && activeTool === 'select') {
          e.stopPropagation();
          onDoubleClickLocked?.(e.clientX, e.clientY);
        }
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      className={`group absolute rounded-2xl transition-shadow select-none ${
        element.isLocked || activeTool === 'hand' ? 'cursor-default' : 'cursor-grab active:cursor-grabbing'
      } ${
        isSelected
          ? 'ring-2 ring-black shadow-[0_16px_36px_rgba(0,0,0,0.16)]'
          : 'hover:shadow-[0_8px_30px_rgba(0,0,0,0.08)]'
      }`}
      style={{
        transform: `translate(${element.x}px, ${element.y}px)`,
        width: `${element.width}px`,
        height: `${element.height}px`,
        zIndex: element.zIndex,
      }}
    >
      {/* Floating Header Control Bar (ONLY shows when isSelected) */}
      {isSelected && (
        <div
          data-control-bar="true"
          onPointerDown={(e) => e.stopPropagation()}
          className="absolute -top-10 left-0 right-0 h-8 flex items-center justify-between px-2 rounded-xl bg-white/95 dark:bg-[#262626]/95 backdrop-blur-xl border border-black/[0.08] dark:border-white/10 shadow-[0_4px_16px_rgba(0,0,0,0.1)] dark:shadow-[0_4px_20px_rgba(0,0,0,0.4)] z-40 animate-fade-in"
          style={{ pointerEvents: 'auto' }}
        >
          <div className="flex items-center gap-1.5 min-w-0 pr-2">
            <span className="text-[11px] font-medium text-gray-700 dark:text-gray-300 truncate max-w-[140px]">
              {element.name || 'Image'}
            </span>
          </div>

          <div className="flex items-center gap-1">
            <ElementQuickActions element={element} showLock />
          </div>
        </div>
      )}

      {/* Persistent Lock Badge when element is locked */}
      {element.isLocked && (
        <div
          data-lock-badge="true"
          onClick={(e) => {
            e.stopPropagation();
            setSelectedId(element.id);
          }}
          title="Locked (click to select and unlock)"
          className="absolute top-2.5 right-2.5 z-30 flex items-center gap-1 px-2 py-1 rounded-lg bg-black/60 dark:bg-black/80 backdrop-blur-md text-amber-400 text-[10px] font-medium shadow-md pointer-events-auto cursor-pointer hover:bg-black/80 transition"
        >
          <Lock size={11} className="fill-amber-400/20" strokeWidth={2.2} />
          <span>Locked</span>
        </div>
      )}

      {/* Image Content */}
      <div
        className="w-full h-full rounded-2xl overflow-hidden bg-white/50 dark:bg-[#1e1e1e]/60 border border-black/[0.06] dark:border-white/10 shadow-sm flex items-center justify-center pointer-events-auto"
      >
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={element.name || 'Attachment'}
            className="w-full h-full object-contain rounded-2xl pointer-events-none select-none"
            draggable={false}
          />
        ) : (
          <div className="flex items-center justify-center text-gray-400 text-xs">
            Loading image…
          </div>
        )}
      </div>

      {/* 4 Corner Resize Handles (when selected and not locked) */}
      {isSelected && !element.isLocked && activeTool !== 'hand' && (
        <>
          {/* Bottom-right corner (primary handle) */}
          <div
            data-resize-handle="se"
            onPointerDown={(e) => handleResizePointerDown(e, 'se')}
            onPointerMove={handleResizePointerMove}
            onPointerUp={handleResizePointerUp}
            onPointerCancel={handleResizePointerUp}
            title="Drag to resize"
            className="absolute -bottom-2 -right-2 w-5 h-5 cursor-nwse-resize flex items-center justify-center group/se z-30"
            style={{ pointerEvents: 'auto' }}
          >
            <div className="w-3.5 h-3.5 rounded-full bg-white border-2 border-black group-hover/se:scale-125 transition-transform shadow-md" />
          </div>

          {/* Bottom-left corner */}
          <div
            data-resize-handle="sw"
            onPointerDown={(e) => handleResizePointerDown(e, 'sw')}
            onPointerMove={handleResizePointerMove}
            onPointerUp={handleResizePointerUp}
            onPointerCancel={handleResizePointerUp}
            title="Drag to resize"
            className="absolute -bottom-2 -left-2 w-5 h-5 cursor-nesw-resize flex items-center justify-center group/sw z-30"
            style={{ pointerEvents: 'auto' }}
          >
            <div className="w-3.5 h-3.5 rounded-full bg-white border-2 border-black group-hover/sw:scale-125 transition-transform shadow-md" />
          </div>

          {/* Top-right corner */}
          <div
            data-resize-handle="ne"
            onPointerDown={(e) => handleResizePointerDown(e, 'ne')}
            onPointerMove={handleResizePointerMove}
            onPointerUp={handleResizePointerUp}
            onPointerCancel={handleResizePointerUp}
            title="Drag to resize"
            className="absolute -top-2 -right-2 w-5 h-5 cursor-nesw-resize flex items-center justify-center group/ne z-30"
            style={{ pointerEvents: 'auto' }}
          >
            <div className="w-3.5 h-3.5 rounded-full bg-white border-2 border-black group-hover/ne:scale-125 transition-transform shadow-md" />
          </div>

          {/* Top-left corner */}
          <div
            data-resize-handle="nw"
            onPointerDown={(e) => handleResizePointerDown(e, 'nw')}
            onPointerMove={handleResizePointerMove}
            onPointerUp={handleResizePointerUp}
            onPointerCancel={handleResizePointerUp}
            title="Drag to resize"
            className="absolute -top-2 -left-2 w-5 h-5 cursor-nwse-resize flex items-center justify-center group/nw z-30"
            style={{ pointerEvents: 'auto' }}
          >
            <div className="w-3.5 h-3.5 rounded-full bg-white border-2 border-black group-hover/nw:scale-125 transition-transform shadow-md" />
          </div>
        </>
      )}
    </div>
  );
};

export const ImageCard = memo(ImageCardInner, (prev, next) => {
  const pe = prev.element;
  const ne = next.element;
  return (
    pe.id === ne.id &&
    pe.x === ne.x &&
    pe.y === ne.y &&
    pe.width === ne.width &&
    pe.height === ne.height &&
    pe.isLocked === ne.isLocked &&
    pe.zIndex === ne.zIndex &&
    pe.imageKey === ne.imageKey &&
    pe.name === ne.name &&
    prev.onDoubleClickLocked === next.onDoubleClickLocked
  );
});
