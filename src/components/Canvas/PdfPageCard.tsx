import {
  type FC,
  memo,
  useState,
  useEffect,
  useRef,
  useCallback,
} from 'react';
import { GripHorizontal, Lock, Unlock, Trash2 } from 'lucide-react';
import { PdfPageElement } from '../../types';
import { useNotesStore } from '../../store/useNotesStore';
import { useUiStore } from '../../store/useUiStore';
import { getPageImageUrl } from '../../store/imageStore';

interface PdfPageCardProps {
  element: PdfPageElement;
  onDoubleClickLocked?: (clientX: number, clientY: number) => void;
}

const PdfPageCardInner: FC<PdfPageCardProps> = ({ element, onDoubleClickLocked }) => {
  const cardRef = useRef<HTMLDivElement>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  // Ref-based drag state — zero React re-renders during drag
  const isDraggingRef = useRef(false);
  const posRef = useRef({ x: element.x, y: element.y });
  const dragStartRef = useRef<{
    clientX: number;
    clientY: number;
    startX: number;
    startY: number;
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
    handle: 'se' | 'sw';
  } | null>(null);
  const currentDimensionsRef = useRef({ width: element.width, height: element.height });

  // Store actions
  const moveElement = useNotesStore((state) => state.moveElement);
  const moveElements = useNotesStore((state) => state.moveElements);
  const updateElement = useNotesStore((state) => state.updateElement);
  const deleteElement = useNotesStore((state) => state.deleteElement);

  // UI state
  const selectedId = useUiStore((state) => state.selectedId);
  const selectedIds = useUiStore((state) => state.selectedIds);
  const setSelectedId = useUiStore((state) => state.setSelectedId);
  const activeTool = useUiStore((state) => state.activeTool);

  const isSelected = selectedId === element.id || selectedIds.includes(element.id);

  // Sync external position updates (from undo, store changes) when NOT dragging
  useEffect(() => {
    if (!isDraggingRef.current) {
      posRef.current = { x: element.x, y: element.y };
      if (cardRef.current) {
        cardRef.current.style.transform = `translate(${element.x}px, ${element.y}px)`;
      }
    }
  }, [element.x, element.y]);

  useEffect(() => {
    if (!isResizingRef.current) {
      currentDimensionsRef.current = { width: element.width, height: element.height };
      if (cardRef.current) {
        cardRef.current.style.width = `${element.width}px`;
        cardRef.current.style.height = `${element.height}px`;
      }
    }
  }, [element.width, element.height]);

  // Fetch memoized object URL from IDB (§7)
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

  const handleToggleLock = (e: React.MouseEvent) => {
    e.stopPropagation();
    const nextLocked = !element.isLocked;
    updateElement(element.id, { isLocked: nextLocked }, true);
    if (!nextLocked) {
      setSelectedId(element.id);
    }
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    deleteElement(element.id);
    if (selectedId === element.id) setSelectedId(null);
  };

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.closest('button') ||
        target.closest('[data-control-bar]') ||
        target.closest('[data-lock-badge]') ||
        target.closest('[data-resize-handle]')
      ) {
        if (activeTool === 'arrow') return;
        e.stopPropagation();
        return;
      }

      if (activeTool === 'hand' || activeTool === 'arrow') return;
      if (e.button !== 0) return;

      if (element.isLocked) {
        e.stopPropagation();
        setSelectedId(element.id);
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
      const activeNb = state.notebooks.find((n) => n.id === state.activeNotebookId);
      const activeSec = activeNb?.sections.find((s) => s.id === state.activeSectionId);

      const draggedIds = isPartOfMultiSelect ? selectedIds : [element.id];
      const startPositions: Record<string, { type: string; x: number; y: number }> = {};

      for (const id of draggedIds) {
        const el = activeSec?.elements.find((item) => item.id === id);
        if (el) {
          startPositions[id] = { type: el.type, x: el.x, y: el.y };
        }
      }

      dragStartRef.current = {
        clientX: e.clientX,
        clientY: e.clientY,
        startX: posRef.current.x,
        startY: posRef.current.y,
        draggedIds,
        startPositions,
      };
    },
    [element.id, element.isLocked, activeTool, setSelectedId]
  );

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDraggingRef.current || !dragStartRef.current || element.isLocked) return;

    const state = useNotesStore.getState();
    const activeNb = state.notebooks.find((n) => n.id === state.activeNotebookId);
    const activeSec = activeNb?.sections.find((s) => s.id === state.activeSectionId);
    const zoom = activeSec?.viewport.zoom ?? 1;

    const dxCanvas = (e.clientX - dragStartRef.current.clientX) / zoom;
    const dyCanvas = (e.clientY - dragStartRef.current.clientY) / zoom;

    const draggedIds = dragStartRef.current.draggedIds;
    for (const id of draggedIds) {
      const orig = dragStartRef.current.startPositions[id];
      if (orig) {
        const nextX = orig.x + dxCanvas;
        const nextY = orig.y + dyCanvas;
        const node = document.querySelector<HTMLElement>(`[data-element-id="${id}"]`);
        if (node) {
          if (orig.type === 'arrow') {
            node.style.transform = `translate(${dxCanvas}px, ${dyCanvas}px)`;
          } else {
            node.style.transform = `translate(${nextX}px, ${nextY}px)`;
          }
        }
        if (id === element.id) {
          posRef.current = { x: nextX, y: nextY };
        }
      }
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (isDraggingRef.current && dragStartRef.current) {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // Pointer might already be released
      }
      isDraggingRef.current = false;

      const state = useNotesStore.getState();
      const activeNb = state.notebooks.find((n) => n.id === state.activeNotebookId);
      const activeSec = activeNb?.sections.find((s) => s.id === state.activeSectionId);
      const zoom = activeSec?.viewport.zoom ?? 1;

      const dxCanvas = (e.clientX - dragStartRef.current.clientX) / zoom;
      const dyCanvas = (e.clientY - dragStartRef.current.clientY) / zoom;
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
        moveElements(draggedIds, dxCanvas, dyCanvas, true);
      } else {
        moveElement(element.id, posRef.current.x, posRef.current.y, true);
      }
    }
  };

  // Resize pointer handlers
  const handleResizePointerDown = (e: React.PointerEvent, handle: 'se' | 'sw') => {
    if (element.isLocked || activeTool === 'hand') return;
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
      startX: posRef.current.x,
      startY: posRef.current.y,
      handle,
    };
  };

  const handleResizePointerMove = (e: React.PointerEvent) => {
    if (!isResizingRef.current || !resizeStartRef.current) return;
    e.stopPropagation();

    const state = useNotesStore.getState();
    const activeNb = state.notebooks.find((n) => n.id === state.activeNotebookId);
    const activeSec = activeNb?.sections.find((s) => s.id === state.activeSectionId);
    const zoom = activeSec?.viewport.zoom ?? 1;

    const start = resizeStartRef.current;
    const dx = (e.clientX - start.clientX) / zoom;
    const aspectRatio = Math.max(0.1, start.startWidth / start.startHeight);

    let nextWidth = start.startWidth;
    let nextHeight = start.startHeight;

    if (start.handle === 'se') {
      nextWidth = Math.max(160, Math.round(start.startWidth + dx));
      nextHeight = Math.max(120, Math.round(nextWidth / aspectRatio));
    } else if (start.handle === 'sw') {
      nextWidth = Math.max(160, Math.round(start.startWidth - dx));
      nextHeight = Math.max(120, Math.round(nextWidth / aspectRatio));
      const nextX = start.startX - (nextWidth - start.startWidth);
      posRef.current = { ...posRef.current, x: nextX };
      if (cardRef.current) {
        cardRef.current.style.transform = `translate(${nextX}px, ${posRef.current.y}px)`;
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

      if (start && start.handle === 'sw') {
        moveElement(element.id, posRef.current.x, posRef.current.y, false);
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

  const handleCardClick = (e: React.MouseEvent) => {
    if (activeTool === 'arrow') return;
    if (activeTool !== 'hand') {
      e.stopPropagation();
      setSelectedId(element.id);
    }
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    if (element.isLocked && activeTool !== 'hand' && activeTool !== 'arrow') {
      e.stopPropagation();
      onDoubleClickLocked?.(e.clientX, e.clientY);
    }
  };

  const ringStyle = isSelected
    ? 'ring-2 ring-black shadow-[0_16px_48px_rgba(0,0,0,0.16)]'
    : 'shadow-[0_12px_40px_rgba(0,0,0,0.08)] border border-black/[0.08]';

  return (
    <div
      ref={cardRef}
      id={`pdf-page-${element.id}`}
      data-element-id={element.id}
      onClick={handleCardClick}
      onDoubleClick={handleDoubleClick}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      className={`absolute rounded-2xl bg-white select-none transition-shadow duration-150 ${ringStyle} ${
        element.isLocked || activeTool === 'hand' ? 'cursor-default' : 'cursor-grab active:cursor-grabbing'
      }`}
      style={{
        transform: `translate(${element.x}px, ${element.y}px)`,
        width: element.width,
        height: element.height,
        zIndex: element.zIndex,
      }}
    >
      {/* Floating Control Bar (ONLY shows when isSelected) */}
      {isSelected && (
        <div
          data-control-bar="true"
          onPointerDown={(e) => e.stopPropagation()}
          className="absolute -top-10 left-0 right-0 h-8 flex items-center justify-between px-2.5 rounded-xl bg-white/95 dark:bg-[#262626]/95 backdrop-blur-xl border border-black/[0.08] dark:border-white/10 shadow-[0_4px_16px_rgba(0,0,0,0.1)] dark:shadow-[0_4px_20px_rgba(0,0,0,0.4)] z-40 animate-fade-in"
          style={{ pointerEvents: 'auto' }}
        >
          <div className="flex items-center gap-2 min-w-0 pr-2">
            <GripHorizontal size={14} className="text-gray-400 shrink-0" />
            <span className="px-2 py-0.5 rounded-full bg-black/5 dark:bg-white/10 text-[10px] font-semibold text-gray-700 dark:text-gray-300">
              p. {element.pageNumber} of {element.totalPages}
            </span>
            <span className="text-[11px] font-medium text-gray-600 dark:text-gray-400 truncate max-w-[140px]">
              {element.pdfName}
            </span>
          </div>

          <div className="flex items-center gap-1">
            {/* Lock / Unlock Toggle Button */}
            <button
              type="button"
              onClick={handleToggleLock}
              onPointerDown={(e) => e.stopPropagation()}
              title={element.isLocked ? 'Unlock Page (currently locked)' : 'Lock Page'}
              className={`w-7 h-7 rounded-lg flex items-center justify-center transition cursor-pointer ${
                element.isLocked
                  ? 'bg-amber-100 text-amber-500 hover:bg-amber-200 ring-1 ring-amber-400/40 shadow-xs'
                  : 'text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white hover:bg-black/[0.05] dark:hover:bg-white/10'
              }`}
            >
              {element.isLocked ? (
                <Lock size={13} className="text-amber-500 fill-amber-500/20" strokeWidth={2.5} />
              ) : (
                <Unlock size={13} strokeWidth={2} />
              )}
            </button>

            {/* Delete Button */}
            <button
              type="button"
              onClick={handleDelete}
              onPointerDown={(e) => e.stopPropagation()}
              title="Delete Page"
              className="w-7 h-7 rounded-lg flex items-center justify-center text-gray-500 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition cursor-pointer"
            >
              <Trash2 size={13} />
            </button>
          </div>
        </div>
      )}

      {/* Persistent Lock Badge when page is locked */}
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

      {/* Page image layer */}
      <div
        className="w-full h-full relative bg-white rounded-2xl overflow-hidden pointer-events-auto cursor-pointer"
      >
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={`${element.pdfName} page ${element.pageNumber}`}
            className="w-full h-full object-contain select-none pointer-events-none"
            draggable={false}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gray-50 text-gray-400 text-xs font-mono">
            Loading page {element.pageNumber}...
          </div>
        )}
      </div>

      {/* Resize Handles (Bottom-right and Bottom-left corner handles) */}
      {isSelected && !element.isLocked && activeTool !== 'hand' && (
        <>
          {/* Bottom-right corner (primary) */}
          <div
            data-resize-handle="se"
            onPointerDown={(e) => handleResizePointerDown(e, 'se')}
            onPointerMove={handleResizePointerMove}
            onPointerUp={handleResizePointerUp}
            onPointerCancel={handleResizePointerUp}
            title="Drag to resize page"
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
            title="Drag to resize page"
            className="absolute -bottom-2 -left-2 w-5 h-5 cursor-nesw-resize flex items-center justify-center group/sw z-30"
            style={{ pointerEvents: 'auto' }}
          >
            <div className="w-3.5 h-3.5 rounded-full bg-white border-2 border-black group-hover/sw:scale-125 transition-transform shadow-md" />
          </div>
        </>
      )}
    </div>
  );
};

export const PdfPageCard = memo(PdfPageCardInner, (prev, next) => {
  // Only re-render if the element data actually changed
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
    pe.pageNumber === ne.pageNumber &&
    pe.totalPages === ne.totalPages &&
    pe.pdfName === ne.pdfName &&
    prev.onDoubleClickLocked === next.onDoubleClickLocked
  );
});
