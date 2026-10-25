import { type FC, memo, useCallback, useRef } from 'react';
import { RectElement } from '../../types';
import { useNotesStore } from '../../store/useNotesStore';
import { useUiStore } from '../../store/useUiStore';
import { useThemeStore } from '../../store/useThemeStore';
import { resolveShapeColor, withAlpha } from '../../utils/color';
import { ElementQuickActions } from './ElementQuickActions';

interface RectCardProps {
  element: RectElement;
}

type ResizeHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

interface RectGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Smallest allowed rectangle edge in canvas units. */
const MIN_SIZE = 24;

const HANDLES: Array<{ handle: ResizeHandle; className: string; cursor: string }> = [
  { handle: 'nw', className: '-top-1.5 -left-1.5', cursor: 'cursor-nwse-resize' },
  { handle: 'n', className: '-top-1.5 left-1/2 -translate-x-1/2', cursor: 'cursor-ns-resize' },
  { handle: 'ne', className: '-top-1.5 -right-1.5', cursor: 'cursor-nesw-resize' },
  { handle: 'e', className: 'top-1/2 -right-1.5 -translate-y-1/2', cursor: 'cursor-ew-resize' },
  { handle: 'se', className: '-bottom-1.5 -right-1.5', cursor: 'cursor-nwse-resize' },
  { handle: 's', className: '-bottom-1.5 left-1/2 -translate-x-1/2', cursor: 'cursor-ns-resize' },
  { handle: 'sw', className: '-bottom-1.5 -left-1.5', cursor: 'cursor-nesw-resize' },
  { handle: 'w', className: 'top-1/2 -left-1.5 -translate-y-1/2', cursor: 'cursor-ew-resize' },
];

const RectCardInner: FC<RectCardProps> = ({ element }) => {
  const selectedId = useUiStore((state) => state.selectedId);
  const selectedIds = useUiStore((state) => state.selectedIds);
  const setSelectedId = useUiStore((state) => state.setSelectedId);
  const activeTool = useUiStore((state) => state.activeTool);

  const theme = useThemeStore((state) => state.theme);
  const isDark = theme === 'dark';

  const updateElement = useNotesStore((state) => state.updateElement);
  const moveElement = useNotesStore((state) => state.moveElement);
  const moveElements = useNotesStore((state) => state.moveElements);

  const cardRef = useRef<HTMLDivElement>(null);

  const isSelected = selectedId === element.id || selectedIds.includes(element.id);
  const isDirectlySelected = selectedId === element.id && selectedIds.length <= 1;

  const isDraggingRef = useRef(false);
  const dragStartRef = useRef<{
    clientX: number;
    clientY: number;
    offsets: Array<{ id: string; type: string; x: number; y: number }>;
  } | null>(null);

  const isResizingRef = useRef(false);
  const resizeHandleRef = useRef<ResizeHandle | null>(null);
  const resizeStartRef = useRef<{
    clientX: number;
    clientY: number;
    geometry: RectGeometry;
  } | null>(null);
  const liveGeometryRef = useRef<RectGeometry | null>(null);

  const color = resolveShapeColor(element.color, isDark);
  const radius = Math.max(0, Math.min(element.radius, element.width / 2, element.height / 2));

  /** Applies geometry straight to the DOM so dragging stays at frame rate. */
  const applyLiveGeometry = useCallback((geometry: RectGeometry) => {
    const node = cardRef.current;
    if (!node) return;
    node.style.transform = `translate(${geometry.x}px, ${geometry.y}px)`;
    node.style.width = `${geometry.width}px`;
    node.style.height = `${geometry.height}px`;
    liveGeometryRef.current = geometry;
  }, []);

  const handlePointerDown = (e: React.PointerEvent) => {
    if (activeTool !== 'select') return;
    const target = e.target as HTMLElement;
    if (target.closest('button') || target.closest('[data-control-bar]') || target.closest('[data-resize-handle]')) {
      e.stopPropagation();
      return;
    }

    e.stopPropagation();

    const { selectedIds: currentIds, selectedId: currentId } = useUiStore.getState();
    const isPartOfMultiSelect = currentIds.includes(element.id) && currentIds.length > 1;
    if (!isPartOfMultiSelect && currentId !== element.id) {
      setSelectedId(element.id);
    }

    if (e.button !== 0) return;

    e.currentTarget.setPointerCapture(e.pointerId);
    isDraggingRef.current = true;

    const state = useNotesStore.getState();
    const section = state.notebooks
      .find((nb) => nb.id === state.activeNotebookId)
      ?.sections.find((sec) => sec.id === state.activeSectionId);

    const draggedIds = isPartOfMultiSelect ? currentIds : [element.id];
    const offsets = draggedIds
      .map((id) => section?.elements.find((el) => el.id === id))
      .filter((el): el is NonNullable<typeof el> => Boolean(el))
      .map((el) => ({ id: el.id, type: el.type, x: el.x, y: el.y }));

    dragStartRef.current = {
      clientX: e.clientX,
      clientY: e.clientY,
      offsets,
    };
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDraggingRef.current || !dragStartRef.current) return;

    const state = useNotesStore.getState();
    const zoom =
      state.notebooks
        .find((nb) => nb.id === state.activeNotebookId)
        ?.sections.find((sec) => sec.id === state.activeSectionId)?.viewport.zoom ?? 1;

    const dx = (e.clientX - dragStartRef.current.clientX) / zoom;
    const dy = (e.clientY - dragStartRef.current.clientY) / zoom;

    const offsets = dragStartRef.current.offsets;

    for (const offset of offsets) {
      const node = document.querySelector<HTMLElement>(`[data-element-id="${offset.id}"]`);
      if (!node) continue;
      node.style.transform =
        offset.type === 'arrow'
          ? `translate(${dx}px, ${dy}px)`
          : `translate(${offset.x + dx}px, ${offset.y + dy}px)`;
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!isDraggingRef.current || !dragStartRef.current) return;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // Pointer may already be released.
    }
    isDraggingRef.current = false;

    const state = useNotesStore.getState();
    const zoom =
      state.notebooks
        .find((nb) => nb.id === state.activeNotebookId)
        ?.sections.find((sec) => sec.id === state.activeSectionId)?.viewport.zoom ?? 1;

    const dx = (e.clientX - dragStartRef.current.clientX) / zoom;
    const dy = (e.clientY - dragStartRef.current.clientY) / zoom;
    const offsets = dragStartRef.current.offsets;
    const draggedIds = offsets.map((offset) => offset.id);
    dragStartRef.current = null;

    // Arrow roots only carry a temporary CSS transform during drag.
    for (const offset of offsets) {
      if (offset.type !== 'arrow') continue;
      const node = document.querySelector<HTMLElement>(`[data-element-id="${offset.id}"]`);
      if (node) node.style.transform = '';
    }

    if (dx === 0 && dy === 0) return;

    if (draggedIds.length > 1) {
      moveElements(draggedIds, dx, dy, true);
    } else {
      moveElement(element.id, element.x + dx, element.y + dy, true);
    }
  };

  const handleResizePointerDown = (e: React.PointerEvent, handle: ResizeHandle) => {
    if (activeTool !== 'select') return;
    e.stopPropagation();
    e.preventDefault();
    if (e.button !== 0) return;

    e.currentTarget.setPointerCapture(e.pointerId);
    isResizingRef.current = true;
    resizeHandleRef.current = handle;
    resizeStartRef.current = {
      clientX: e.clientX,
      clientY: e.clientY,
      geometry: {
        x: element.x,
        y: element.y,
        width: element.width,
        height: element.height,
      },
    };
    liveGeometryRef.current = null;
  };

  const handleResizePointerMove = (e: React.PointerEvent) => {
    if (!isResizingRef.current || !resizeStartRef.current || !resizeHandleRef.current) return;
    e.stopPropagation();

    const state = useNotesStore.getState();
    const zoom =
      state.notebooks
        .find((nb) => nb.id === state.activeNotebookId)
        ?.sections.find((sec) => sec.id === state.activeSectionId)?.viewport.zoom ?? 1;

    const start = resizeStartRef.current.geometry;
    const dx = (e.clientX - resizeStartRef.current.clientX) / zoom;
    const dy = (e.clientY - resizeStartRef.current.clientY) / zoom;
    const handle = resizeHandleRef.current;

    let { x, y, width, height } = start;

    if (handle.includes('e')) width = start.width + dx;
    if (handle.includes('s')) height = start.height + dy;
    if (handle.includes('w')) {
      width = start.width - dx;
      x = start.x + dx;
    }
    if (handle.includes('n')) {
      height = start.height - dy;
      y = start.y + dy;
    }

    // Shift keeps the original aspect ratio for corner drags.
    if (e.shiftKey && handle.length === 2) {
      const aspect = start.width / start.height;
      if (Math.abs(dx) > Math.abs(dy)) {
        height = width / aspect;
        if (handle.includes('n')) y = start.y + start.height - height;
      } else {
        width = height * aspect;
        if (handle.includes('w')) x = start.x + start.width - width;
      }
    }

    // Clamp to the minimum size while keeping the opposite edge anchored.
    if (width < MIN_SIZE) {
      if (handle.includes('w')) x = start.x + start.width - MIN_SIZE;
      width = MIN_SIZE;
    }
    if (height < MIN_SIZE) {
      if (handle.includes('n')) y = start.y + start.height - MIN_SIZE;
      height = MIN_SIZE;
    }

    applyLiveGeometry({
      x: Math.round(x),
      y: Math.round(y),
      width: Math.round(width),
      height: Math.round(height),
    });
  };

  const handleResizePointerUp = (e: React.PointerEvent) => {
    if (!isResizingRef.current) return;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // Pointer may already be released.
    }
    isResizingRef.current = false;
    resizeHandleRef.current = null;
    resizeStartRef.current = null;

    const geometry = liveGeometryRef.current;
    liveGeometryRef.current = null;
    if (!geometry) return;

    updateElement(
      element.id,
      {
        x: geometry.x,
        y: geometry.y,
        width: geometry.width,
        height: geometry.height,
      },
      true
    );
  };

  return (
    <div
      ref={cardRef}
      id={`rect-${element.id}`}
      data-element-id={element.id}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      className={`group absolute top-0 left-0 select-none ${
        isSelected ? 'ring-1 ring-blue-500/70' : 'hover:ring-1 hover:ring-gray-400/40'
      }`}
      style={{
        transform: `translate(${element.x}px, ${element.y}px)`,
        width: element.width,
        height: element.height,
        borderRadius: radius,
        border: `${element.strokeWidth}px solid ${color}`,
        backgroundColor: withAlpha(color, isDark ? 0.14 : 0.08),
        zIndex: element.zIndex,
        cursor: activeTool === 'select' ? 'move' : 'crosshair',
      }}
    >
      {/* Floating action bar above the shape */}
      {isSelected && (
        <div
          data-control-bar="true"
          onPointerDown={(e) => e.stopPropagation()}
          className={`absolute -top-9 left-1/2 -translate-x-1/2 flex items-center gap-1 px-1.5 py-1 rounded-xl bg-white/95 dark:bg-[#262626]/95 backdrop-blur-xl border border-black/10 dark:border-white/10 shadow-[0_4px_16px_rgba(0,0,0,0.12)] dark:shadow-[0_4px_20px_rgba(0,0,0,0.4)] no-drag ${
            isDirectlySelected ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}
        >
          <ElementQuickActions element={element} />
        </div>
      )}

      {/* Resize handles — corners and edges, all live-scaling */}
      {isSelected && (
        <>
          {HANDLES.map(({ handle, className, cursor }) => (
            <div
              key={handle}
              data-resize-handle={handle}
              onPointerDown={(e) => handleResizePointerDown(e, handle)}
              onPointerMove={handleResizePointerMove}
              onPointerUp={handleResizePointerUp}
              onPointerCancel={handleResizePointerUp}
              className={`absolute w-4 h-4 flex items-center justify-center ${className} ${cursor} z-20`}
              style={{ pointerEvents: 'auto' }}
            >
              <div className="w-2.5 h-2.5 rounded-full bg-white dark:bg-[#262626] border-[1.5px] border-gray-600 dark:border-gray-300 shadow-xs" />
            </div>
          ))}
        </>
      )}
    </div>
  );
};

export const RectCard = memo(RectCardInner, (prev, next) => {
  const pe = prev.element;
  const ne = next.element;
  return (
    pe.id === ne.id &&
    pe.x === ne.x &&
    pe.y === ne.y &&
    pe.width === ne.width &&
    pe.height === ne.height &&
    pe.radius === ne.radius &&
    pe.color === ne.color &&
    pe.strokeWidth === ne.strokeWidth &&
    pe.zIndex === ne.zIndex
  );
});
