import { type FC, memo, useRef, useCallback } from 'react';
import { ArrowLeftRight, RotateCw } from 'lucide-react';
import { ArrowElement } from '../../types';
import { useNotesStore } from '../../store/useNotesStore';
import { useUiStore } from '../../store/useUiStore';
import { useThemeStore } from '../../store/useThemeStore';
import { ElementQuickActions } from './ElementQuickActions';

interface ArrowCardProps {
  element: ArrowElement;
}

const ArrowCardInner: FC<ArrowCardProps> = ({ element }) => {
  const selectedId = useUiStore((state) => state.selectedId);
  const selectedIds = useUiStore((state) => state.selectedIds);
  const setSelectedId = useUiStore((state) => state.setSelectedId);
  const activeTool = useUiStore((state) => state.activeTool);

  const theme = useThemeStore((state) => state.theme);
  const isDark = theme === 'dark';

  const updateElement = useNotesStore((state) => state.updateElement);
  const moveElements = useNotesStore((state) => state.moveElements);

  const isSelected = selectedId === element.id || selectedIds.includes(element.id);
  // The floating action bar ("dialog box") should ONLY appear when this arrow is directly and individually selected,
  // NOT when selected via marquee/drag selection or part of a multi-selection.
  const isDirectlySelected = selectedId === element.id && selectedIds.length <= 1;

  // Drag interaction refs for handles
  const isDraggingHandleRef = useRef<'start' | 'end' | 'control' | 'body' | null>(null);
  const dragStartRef = useRef<{
    clientX: number;
    clientY: number;
    startX: number;
    startY: number;
    endX: number;
    endY: number;
    controlOffset: number;
    draggedIds?: string[];
    startPositions?: Record<string, { type: string; x: number; y: number }>;
  } | null>(null);

  const { startX, startY, endX, endY } = element;
  const strokeWidth = element.strokeWidth || 1.8;
  // Default black in light mode, crisp gray/white in dark mode
  const color = element.color
    ? isDark && (element.color === '#000000' || element.color === '#111827')
      ? '#ECECEC'
      : element.color
    : isDark
    ? '#ECECEC'
    : '#000000';
  const arrowHeadPosition = element.arrowHeadPosition || 'start'; // Default: head at the first clicked point

  // Geometry calculations
  const dx = endX - startX;
  const dy = endY - startY;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const safeDist = Math.max(dist, 1);

  // Normal vector perpendicular to the chord line
  const nx = -dy / safeDist;
  const ny = dx / safeDist;

  // Arc curvature height (signed: positive or negative for upward/downward arch)
  const h = element.controlOffset !== undefined ? element.controlOffset : Math.max(28, Math.min(260, safeDist * 0.28));

  // Midpoint
  const mx = (startX + endX) / 2;
  const my = (startY + endY) / 2;

  // Quadratic Bézier control point
  const cx = mx + nx * h;
  const cy = my + ny * h;

  // Sleek, modern arrowhead dimensions (11.5px length, 8.4px total width)
  const headLen = 11.5;
  const headWidth = 4.2;

  const hasStartHead = arrowHeadPosition === 'start' || arrowHeadPosition === 'both';
  const hasEndHead = arrowHeadPosition === 'end' || arrowHeadPosition === 'both';

  // Tangent unit vectors for arrowheads pointing towards their respective tips
  // At start (t=0): tangent towards start point (startX, startY)
  const vStartX = startX - cx;
  const vStartY = startY - cy;
  const lenStart = Math.hypot(vStartX, vStartY) || 1;
  const uxStart = vStartX / lenStart;
  const uyStart = vStartY / lenStart;
  const vxStart = -uyStart;
  const vyStart = uxStart;

  // Arrowhead polygon at start
  const startTipX = startX;
  const startTipY = startY;
  const startBaseX = startTipX - uxStart * headLen;
  const startBaseY = startTipY - uyStart * headLen;
  const startLeftX = startBaseX + vxStart * headWidth;
  const startLeftY = startBaseY + vyStart * headWidth;
  const startRightX = startBaseX - vxStart * headWidth;
  const startRightY = startBaseY - vyStart * headWidth;

  // At end (t=1): tangent towards end point (endX, endY)
  const vEndX = endX - cx;
  const vEndY = endY - cy;
  const lenEnd = Math.hypot(vEndX, vEndY) || 1;
  const uxEnd = vEndX / lenEnd;
  const uyEnd = vEndY / lenEnd;
  const vxEnd = -uyEnd;
  const vyEnd = uxEnd;

  // Arrowhead polygon at end
  const endTipX = endX;
  const endTipY = endY;
  const endBaseX = endTipX - uxEnd * headLen;
  const endBaseY = endTipY - uyEnd * headLen;
  const endLeftX = endBaseX + vxEnd * headWidth;
  const endLeftY = endBaseY + vyEnd * headWidth;
  const endRightX = endBaseX - vxEnd * headWidth;
  const endRightY = endBaseY - vyEnd * headWidth;

  // Shaft path endpoints: recessed inside arrowhead by (headLen - 2.0) so rounded linecap never pokes out of the tip
  const pathStartX = hasStartHead ? startTipX - uxStart * (headLen - 2.0) : startX;
  const pathStartY = hasStartHead ? startTipY - uyStart * (headLen - 2.0) : startY;
  const pathEndX = hasEndHead ? endTipX - uxEnd * (headLen - 2.0) : endX;
  const pathEndY = hasEndHead ? endTipY - uyEnd * (headLen - 2.0) : endY;

  // Handle pointer down for endpoints or curvature
  const handlePointerDown = useCallback(
    (e: React.PointerEvent, handleType: 'start' | 'end' | 'control' | 'body') => {
      if (activeTool !== 'select') return;
      e.stopPropagation();

      const { selectedIds, selectedId } = useUiStore.getState();
      const isPartOfMultiSelect = handleType === 'body' && selectedIds.includes(element.id) && selectedIds.length > 1;

      if (!isPartOfMultiSelect && selectedId !== element.id) {
        setSelectedId(element.id);
      }

      if (e.button !== 0) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      isDraggingHandleRef.current = handleType;

      let draggedIds: string[] | undefined;
      let startPositions: Record<string, { type: string; x: number; y: number }> | undefined;

      if (isPartOfMultiSelect) {
        draggedIds = selectedIds;
        startPositions = {};
        const state = useNotesStore.getState();
        const currentNb = state.notebooks.find((nb) => nb.id === state.activeNotebookId);
        const currentSec = currentNb?.sections.find((s) => s.id === state.activeSectionId);
        for (const id of draggedIds) {
          const el = currentSec?.elements.find((item) => item.id === id);
          if (el) {
            startPositions[id] = { type: el.type, x: el.x, y: el.y };
          }
        }
      }

      dragStartRef.current = {
        clientX: e.clientX,
        clientY: e.clientY,
        startX: element.startX,
        startY: element.startY,
        endX: element.endX,
        endY: element.endY,
        controlOffset: h,
        draggedIds,
        startPositions,
      };
    },
    [activeTool, element.id, element.startX, element.startY, element.endX, element.endY, h, setSelectedId]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isDraggingHandleRef.current || !dragStartRef.current) return;
      e.stopPropagation();

      const state = useNotesStore.getState();
      const currentNb = state.notebooks.find((nb) => nb.id === state.activeNotebookId);
      const currentSec = currentNb?.sections.find((s) => s.id === state.activeSectionId);
      const zoom = currentSec?.viewport.zoom ?? 1;

      const dCanvasX = (e.clientX - dragStartRef.current.clientX) / zoom;
      const dCanvasY = (e.clientY - dragStartRef.current.clientY) / zoom;

      const handle = isDraggingHandleRef.current;

      if (handle === 'start') {
        const nextStartX = dragStartRef.current.startX + dCanvasX;
        const nextStartY = dragStartRef.current.startY + dCanvasY;
        updateElement(element.id, { startX: nextStartX, startY: nextStartY }, false);
      } else if (handle === 'end') {
        const nextEndX = dragStartRef.current.endX + dCanvasX;
        const nextEndY = dragStartRef.current.endY + dCanvasY;
        updateElement(element.id, { endX: nextEndX, endY: nextEndY }, false);
      } else if (handle === 'control') {
        // Project cursor displacement onto normal vector to adjust arch
        const deltaOffset = dCanvasX * nx + dCanvasY * ny;
        const nextOffset = dragStartRef.current.controlOffset + deltaOffset;
        updateElement(element.id, { controlOffset: nextOffset }, false);
      } else if (handle === 'body') {
        const draggedIds = dragStartRef.current.draggedIds;
        if (draggedIds && draggedIds.length > 1 && dragStartRef.current.startPositions) {
          for (const id of draggedIds) {
            const pos = dragStartRef.current.startPositions[id];
            if (pos) {
              const node = document.querySelector<HTMLElement>(`[data-element-id="${id}"]`);
              if (node) {
                if (pos.type === 'arrow') {
                  node.style.transform = `translate(${dCanvasX}px, ${dCanvasY}px)`;
                } else {
                  node.style.transform = `translate(${pos.x + dCanvasX}px, ${pos.y + dCanvasY}px)`;
                }
              }
            }
          }
        } else {
          const node = document.querySelector<HTMLElement>(`[data-element-id="${element.id}"]`);
          if (node) {
            node.style.transform = `translate(${dCanvasX}px, ${dCanvasY}px)`;
          }
        }
      }
    },
    [element.id, nx, ny, updateElement]
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (isDraggingHandleRef.current && dragStartRef.current) {
        try {
          e.currentTarget.releasePointerCapture(e.pointerId);
        } catch {}

        const handle = isDraggingHandleRef.current;
        const draggedIds = dragStartRef.current.draggedIds;

        const state = useNotesStore.getState();
        const currentNb = state.notebooks.find((nb) => nb.id === state.activeNotebookId);
        const currentSec = currentNb?.sections.find((s) => s.id === state.activeSectionId);
        const zoom = currentSec?.viewport.zoom ?? 1;

        const dCanvasX = (e.clientX - dragStartRef.current.clientX) / zoom;
        const dCanvasY = (e.clientY - dragStartRef.current.clientY) / zoom;

        isDraggingHandleRef.current = null;
        dragStartRef.current = null;

        if (handle === 'body') {
          const targetIds = draggedIds && draggedIds.length > 0 ? draggedIds : [element.id];
          // Clear temporary CSS transform on all dragged arrows so SVG paths take over at new coords
          for (const id of targetIds) {
            const el = currentSec?.elements.find((item) => item.id === id);
            if (el?.type === 'arrow') {
              const node = document.querySelector<HTMLElement>(`[data-element-id="${id}"]`);
              if (node) {
                node.style.transform = '';
              }
            }
          }

          if (dCanvasX !== 0 || dCanvasY !== 0) {
            moveElements(targetIds, dCanvasX, dCanvasY, true);
          }
        } else {
          useNotesStore.getState().commitUndoSnapshot();
        }
      }
    },
    [element.id, moveElements]
  );

  // Toggle arrow head position (start vs end vs both)
  const toggleArrowHead = (e: React.MouseEvent) => {
    e.stopPropagation();
    const nextPos: 'start' | 'end' | 'both' =
      arrowHeadPosition === 'start' ? 'end' : arrowHeadPosition === 'end' ? 'both' : 'start';
    updateElement(element.id, { arrowHeadPosition: nextPos }, true);
  };

  // Flip curve direction (bend other side: upward vs downward)
  const flipCurve = (e: React.MouseEvent) => {
    e.stopPropagation();
    updateElement(element.id, { controlOffset: -h }, true);
  };

  return (
    <div
      id={`arrow-${element.id}`}
      data-element-id={element.id}
      className="absolute top-0 left-0 overflow-visible pointer-events-none select-none"
      style={{
        zIndex: element.zIndex || 500,
      }}
    >
      <svg
        className="overflow-visible pointer-events-none"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          overflow: 'visible',
        }}
      >
        {/* Invisible wider stroke (32px) for easy click selection & dragging */}
        <path
          d={`M ${startX} ${startY} Q ${cx} ${cy} ${endX} ${endY}`}
          fill="none"
          stroke="transparent"
          strokeWidth={32}
          strokeLinecap="round"
          style={{ pointerEvents: 'stroke', cursor: activeTool === 'hand' ? 'default' : 'pointer' }}
          onClick={(e) => {
            if (activeTool === 'select') {
              e.stopPropagation();
              setSelectedId(element.id);
            }
          }}
          onPointerDown={(e) => handlePointerDown(e, 'body')}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        />

        {/* Visible smooth curved arrow shaft */}
        <path
          d={`M ${pathStartX} ${pathStartY} Q ${cx} ${cy} ${pathEndX} ${pathEndY}`}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          style={{ pointerEvents: 'stroke', cursor: activeTool === 'hand' ? 'default' : 'pointer' }}
          onClick={(e) => {
            if (activeTool === 'select') {
              e.stopPropagation();
              setSelectedId(element.id);
            }
          }}
          onPointerDown={(e) => handlePointerDown(e, 'body')}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        />

        {/* Arrowhead at Start (Default for labeling) */}
        {(arrowHeadPosition === 'start' || arrowHeadPosition === 'both') && (
          <polygon
            points={`${startTipX},${startTipY} ${startLeftX},${startLeftY} ${startRightX},${startRightY}`}
            fill={color}
            style={{ pointerEvents: 'all', cursor: activeTool === 'hand' ? 'default' : 'pointer' }}
            onClick={(e) => {
              if (activeTool === 'select') {
                e.stopPropagation();
                setSelectedId(element.id);
              }
            }}
            onPointerDown={(e) => handlePointerDown(e, 'body')}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
          />
        )}

        {/* Arrowhead at End */}
        {(arrowHeadPosition === 'end' || arrowHeadPosition === 'both') && (
          <polygon
            points={`${endTipX},${endTipY} ${endLeftX},${endLeftY} ${endRightX},${endRightY}`}
            fill={color}
            style={{ pointerEvents: 'all', cursor: activeTool === 'hand' ? 'default' : 'pointer' }}
            onClick={(e) => {
              if (activeTool === 'select') {
                e.stopPropagation();
                setSelectedId(element.id);
              }
            }}
            onPointerDown={(e) => handlePointerDown(e, 'body')}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
          />
        )}
      </svg>

      {/* Interactive Selection Handles & Controls (visible when selected) */}
      {isSelected && (
        <div style={{ pointerEvents: 'auto' }}>
          {/* Start Point Handle (Resizes / repositions arrow start) */}
          <div
            onPointerDown={(e) => handlePointerDown(e, 'start')}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            title="Drag to resize arrow start position"
            style={{
              position: 'absolute',
              left: `${startX - 7}px`,
              top: `${startY - 7}px`,
              width: '14px',
              height: '14px',
            }}
            className="rounded-full bg-white dark:bg-[#262626] border-2 border-black dark:border-white shadow-lg cursor-crosshair hover:scale-125 transition-transform z-50"
          />

          {/* End Point Handle (Resizes / repositions arrow end & length) */}
          <div
            onPointerDown={(e) => handlePointerDown(e, 'end')}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            title="Drag to resize arrow end & length"
            style={{
              position: 'absolute',
              left: `${endX - 7}px`,
              top: `${endY - 7}px`,
              width: '14px',
              height: '14px',
            }}
            className="rounded-full bg-white dark:bg-[#262626] border-2 border-black dark:border-white shadow-lg cursor-crosshair hover:scale-125 transition-transform z-50"
          />

          {/* Curvature Control Point Handle (Adjusts curve arch) */}
          <div
            onPointerDown={(e) => handlePointerDown(e, 'control')}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            title="Drag to adjust curve arch"
            style={{
              position: 'absolute',
              left: `${cx - 6}px`,
              top: `${cy - 6}px`,
              width: '12px',
              height: '12px',
            }}
            className="rounded-full bg-black dark:bg-white hover:bg-gray-800 dark:hover:bg-gray-200 border-2 border-white dark:border-black shadow-md cursor-move hover:scale-125 transition-transform z-50"
          />

          {/* Floating Action Bar centered above the midpoint (only for directly selected single arrow) */}
          {isDirectlySelected && (
            <div
              data-control-bar="true"
              onPointerDown={(e) => e.stopPropagation()}
              style={{
                position: 'absolute',
                left: `${cx}px`,
                top: `${cy - 36}px`,
                transform: 'translateX(-50%)',
              }}
              className="flex items-center gap-1 px-2 py-1 rounded-xl bg-white/95 dark:bg-[#262626]/95 backdrop-blur-xl border border-black/10 dark:border-white/10 shadow-[0_4px_16px_rgba(0,0,0,0.12)] dark:shadow-[0_4px_20px_rgba(0,0,0,0.4)] z-50 animate-fade-in no-drag whitespace-nowrap"
            >
              <button
                type="button"
                onClick={toggleArrowHead}
                title={`Arrowhead: ${arrowHeadPosition}. Click to toggle.`}
                className="px-2 py-1 rounded-lg flex items-center gap-1.5 text-xs font-medium text-gray-700 dark:text-gray-200 hover:text-black dark:hover:text-white hover:bg-black/[0.05] dark:hover:bg-white/[0.08] transition cursor-pointer"
              >
                <ArrowLeftRight size={13} />
                <span className="capitalize">{arrowHeadPosition}</span>
              </button>

              <button
                type="button"
                onClick={flipCurve}
                title="Flip curve (upward / downward)"
                className="px-2 py-1 rounded-lg flex items-center gap-1.5 text-xs font-medium text-gray-700 dark:text-gray-200 hover:text-black dark:hover:text-white hover:bg-black/[0.05] dark:hover:bg-white/[0.08] transition cursor-pointer"
              >
                <RotateCw size={13} />
                <span>Flip Arch</span>
              </button>

              <ElementQuickActions element={element} />
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export const ArrowCard = memo(ArrowCardInner, (prev, next) => {
  const pe = prev.element;
  const ne = next.element;
  return (
    pe.id === ne.id &&
    pe.startX === ne.startX &&
    pe.startY === ne.startY &&
    pe.endX === ne.endX &&
    pe.endY === ne.endY &&
    pe.controlOffset === ne.controlOffset &&
    pe.color === ne.color &&
    pe.strokeWidth === ne.strokeWidth &&
    pe.arrowHeadPosition === ne.arrowHeadPosition &&
    pe.zIndex === ne.zIndex
  );
});
