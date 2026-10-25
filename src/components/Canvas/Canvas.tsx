import {
  type FC,
  type ReactNode,
  useRef,
  useEffect,
  useState,
  useCallback,
} from 'react';
import { useNotesStore } from '../../store/useNotesStore';
import { useUiStore } from '../../store/useUiStore';
import { useThemeStore } from '../../store/useThemeStore';
import { useAiStore } from '../../store/aiStore';
import {
  calculateCursorZoom,
  clamp,
  MIN_ZOOM,
  MAX_ZOOM,
  getDotGridStyle,
  screenToCanvas,
} from '../../utils/canvasMath';
import { captureCanvasRegion } from '../../utils/captureRegion';
import { getElementsBBox, sendCanvasRegionToAI } from '../../utils/aiActions';
import { Viewport, ArrowElement, CanvasElement, RectElement } from '../../types';
import { rememberCopiedPlainText } from '../../utils/elementActions';
import { resolveShapeColor, withAlpha } from '../../utils/color';
import { WorldLayer } from './WorldLayer';
import { CanvasContextMenu } from './CanvasContextMenu';

interface CanvasProps {
  children?: ReactNode;
  onDoubleClickCanvas?: (canvasX: number, canvasY: number) => void;
}

/** Smallest rectangle that can be drawn with the rectangle tool (canvas units). */
const MIN_RECT_SIZE = 16;
/** Default corner radius for drawn rectangles. */
const DEFAULT_RECT_RADIUS = 14;
/** Drag distance below which a rectangle click counts as a cancel. */
const MIN_RECT_DRAG = 4;

export const Canvas: FC<CanvasProps> = ({ children, onDoubleClickCanvas }) => {
  const containerRef = useRef<HTMLDivElement>(null);

  // Active section & viewport
  const activeSection = useNotesStore((state) => {
    const nb = state.notebooks.find((n) => n.id === state.activeNotebookId);
    return nb?.sections.find((s) => s.id === state.activeSectionId);
  });

  const addElement = useNotesStore((state) => state.addElement);
  const addElements = useNotesStore((state) => state.addElements);
  const setViewport = useNotesStore((state) => state.setViewport);
  const resetViewport = useNotesStore((state) => state.resetViewport);
  const zoomIn = useNotesStore((state) => state.zoomIn);
  const zoomOut = useNotesStore((state) => state.zoomOut);
  const undo = useNotesStore((state) => state.undo);
  const redo = useNotesStore((state) => state.redo);
  const deleteElements = useNotesStore((state) => state.deleteElements);

  // UI state
  const selectedId = useUiStore((state) => state.selectedId);
  const selectedIds = useUiStore((state) => state.selectedIds);
  const editingId = useUiStore((state) => state.editingId);
  const activeTool = useUiStore((state) => state.activeTool);
  const setSelectedId = useUiStore((state) => state.setSelectedId);
  const setSelectedIds = useUiStore((state) => state.setSelectedIds);
  const clearSelection = useUiStore((state) => state.clearSelection);
  const setEditingId = useUiStore((state) => state.setEditingId);
  const setActiveTool = useUiStore((state) => state.setActiveTool);
  const shapeColorDefault = useUiStore((state) => state.shapeDefaults.color);

  const theme = useThemeStore((state) => state.theme);
  const isDark = theme === 'dark';

  // Fallback viewport
  const viewport = activeSection?.viewport ?? { x: 0, y: 0, zoom: 1 };
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;

  // Pan interaction state
  const [isPanning, setIsPanning] = useState(false);
  const [isSpacePressed, setIsSpacePressed] = useState(false);
  const panStartRef = useRef<{ clientX: number; clientY: number; startX: number; startY: number } | null>(null);

  // Marquee (Drag-to-select rectangle) State
  const [marqueeBox, setMarqueeBox] = useState<{
    startX: number;
    startY: number;
    currentX: number;
    currentY: number;
  } | null>(null);
  const marqueeBoxRef = useRef(marqueeBox);
  marqueeBoxRef.current = marqueeBox;
  const isMarqueeDraggingRef = useRef(false);
  const justFinishedMarqueeRef = useRef(false);

  // Custom right-click context menu
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    elementId: string | null;
    canvasX: number;
    canvasY: number;
  } | null>(null);

  // Track mouse coordinates for anchor zoom
  const mousePosRef = useRef({
    clientX: typeof window !== 'undefined' ? window.innerWidth / 2 : 0,
    clientY: typeof window !== 'undefined' ? window.innerHeight / 2 : 0,
  });
  const isGesturingRef = useRef(false);

  // Curved Arrow Drafting State
  const [arrowDraft, setArrowDraft] = useState<{
    startX: number;
    startY: number;
    currentX: number;
    currentY: number;
    isFlipped: boolean;
  } | null>(null);
  const arrowDraftRef = useRef(arrowDraft);
  arrowDraftRef.current = arrowDraft;
  const arrowPointerDownTimeRef = useRef<number>(0);
  const justCommittedArrowRef = useRef(false);

  // Rectangle Drafting State
  const [rectDraft, setRectDraft] = useState<{
    startX: number;
    startY: number;
    currentX: number;
    currentY: number;
  } | null>(null);
  const rectDraftRef = useRef(rectDraft);
  rectDraftRef.current = rectDraft;
  const justCommittedRectRef = useRef(false);

  // AI capture (drag-to-screenshot) State
  const [aiCaptureDraft, setAiCaptureDraft] = useState<{
    startX: number;
    startY: number;
    currentX: number;
    currentY: number;
  } | null>(null);
  const aiCaptureDraftRef = useRef(aiCaptureDraft);
  aiCaptureDraftRef.current = aiCaptureDraft;
  const [isCapturingRegion, setIsCapturingRegion] = useState(false);
  const aiCaptureBusyRef = useRef(false);

  useEffect(() => {
    if (activeTool !== 'arrow') {
      setArrowDraft(null);
      arrowDraftRef.current = null;
    }
    if (activeTool !== 'rect') {
      setRectDraft(null);
      rectDraftRef.current = null;
    }
    if (activeTool !== 'ai-capture') {
      setAiCaptureDraft(null);
      aiCaptureDraftRef.current = null;
    }
  }, [activeTool]);

  // Listen for toolbar trigger to flip arrow curve during draft
  useEffect(() => {
    const handleFlipEvent = () => {
      if (arrowDraftRef.current) {
        const nextFlipped = !arrowDraftRef.current.isFlipped;
        arrowDraftRef.current = {
          ...arrowDraftRef.current,
          isFlipped: nextFlipped,
        };
        setArrowDraft((prev) => (prev ? { ...prev, isFlipped: nextFlipped } : null));
      }
    };
    window.addEventListener('inkwell-flip-arrow-draft', handleFlipEvent);
    return () => window.removeEventListener('inkwell-flip-arrow-draft', handleFlipEvent);
  }, []);

  const commitArrow = useCallback(
    (startX: number, startY: number, endX: number, endY: number, isFlipped = false) => {
      const dist = Math.hypot(endX - startX, endY - startY);
      const flip = isFlipped ? -1 : 1;
      const baseH = Math.max(28, Math.min(260, dist * 0.28));

      const newArrow: ArrowElement = {
        id: crypto.randomUUID(),
        type: 'arrow',
        x: Math.min(startX, endX),
        y: Math.min(startY, endY),
        startX,
        startY,
        endX,
        endY,
        controlOffset: flip * baseH,
        color: useUiStore.getState().shapeDefaults.color || '#000000',
        strokeWidth: 1.8,
        arrowHeadPosition: 'start', // Arrowhead at first clicked point
        zIndex: 500,
      };

      addElement(newArrow);
      setSelectedId(newArrow.id);
      justCommittedArrowRef.current = true;
      arrowDraftRef.current = null;
      setArrowDraft(null);
      setActiveTool('select');
    },
    [addElement, setSelectedId, setActiveTool]
  );

  const commitRect = useCallback(
    (startX: number, startY: number, endX: number, endY: number) => {      const x = Math.min(startX, endX);
      const y = Math.min(startY, endY);
      const width = Math.abs(endX - startX);
      const height = Math.abs(endY - startY);

      const newRect: RectElement = {
        id: crypto.randomUUID(),
        type: 'rect',
        x: Math.round(x),
        y: Math.round(y),
        width: Math.max(MIN_RECT_SIZE, Math.round(width)),
        height: Math.max(MIN_RECT_SIZE, Math.round(height)),
        radius: DEFAULT_RECT_RADIUS,
        color: useUiStore.getState().shapeDefaults.color || '',
        strokeWidth: 2,
        // Annotation boxes sit above images but behind notes and arrows.
        zIndex: 150,
      };

      addElement(newRect);
      setSelectedId(newRect.id);
      justCommittedRectRef.current = true;
      rectDraftRef.current = null;
      setRectDraft(null);
      setActiveTool('select');
    },
    [addElement, setSelectedId, setActiveTool]
  );

  /** Sends the current selection (or context-menu target) to the AI sidebar. */
  const handleAskSelection = useCallback(() => {
    if (aiCaptureBusyRef.current) return;
    const ui = useUiStore.getState();
    const ids = new Set<string>([
      ...(ui.selectedId ? [ui.selectedId] : []),
      ...ui.selectedIds,
    ]);
    if (ids.size === 0 || !activeSection) return;
    const elements = activeSection.elements.filter((el) => ids.has(el.id));
    const bbox = getElementsBBox(elements);
    const container = containerRef.current;
    if (!bbox || !container) return;

    const vp = viewportRef.current;
    if (bbox.width * vp.zoom < 16 || bbox.height * vp.zoom < 16) {
      window.dispatchEvent(
        new CustomEvent('inkwell-toast', { detail: 'Selection is too small to send' })
      );
      return;
    }

    // New capture, one gesture — block re-entry until rasterization completes.
    aiCaptureBusyRef.current = true;
    setIsCapturingRegion(true);
    void (async () => {
      try {
        await sendCanvasRegionToAI({
          container,
          region: bbox,
          viewport: vp,
        });
        window.dispatchEvent(
          new CustomEvent('inkwell-toast', { detail: 'Selection sent to Ask' })
        );
      } catch (err) {
        console.error('Ask selection failed:', err);
        window.dispatchEvent(
          new CustomEvent('inkwell-toast', {
            detail: 'Could not send selection. Try again.',
          })
        );
      } finally {
        aiCaptureBusyRef.current = false;
        setIsCapturingRegion(false);
      }
    })();
  }, [activeSection]);

  // Non-passive wheel & native WebKit gesture handler for trackpad pinch zoom & pan
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onMouseMove = (e: MouseEvent) => {
      mousePosRef.current = { clientX: e.clientX, clientY: e.clientY };
    };
    window.addEventListener('mousemove', onMouseMove, { passive: true });

    const onWheel = (e: WheelEvent) => {
      const target = e.target as HTMLElement | null;
      // Don't intercept scrolling inside sidebar
      if (target?.closest('#sidebar-container')) return;

      e.preventDefault();
      // If WebKit GestureEvent is actively controlling pinch zoom, avoid clashing
      if (isGesturingRef.current) return;

      const rect = el.getBoundingClientRect();
      const current = viewportRef.current;
      mousePosRef.current = { clientX: e.clientX, clientY: e.clientY };

      if (e.ctrlKey || e.metaKey) {
        // Trackpad pinch (Blink/Gecko) or Ctrl/Cmd + wheel zoom anchored to cursor
        const px = e.clientX - rect.left;
        const py = e.clientY - rect.top;
        const next = calculateCursorZoom(px, py, e.deltaY, current);
        setViewport(next);
      } else {
        // Trackpad 2-finger scroll pan
        setViewport({
          x: current.x - e.deltaX,
          y: current.y - e.deltaY,
        });
      }
    };

    // Native WebKit gesture tracking (macOS WKWebView & Safari trackpad pinch)
    let gestureStartZoom = 1;
    let gestureStartViewport: Viewport = { x: 0, y: 0, zoom: 1 };
    let gestureAnchorX = 0;
    let gestureAnchorY = 0;

    const onGestureStart = (e: Event) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('#sidebar-container')) return;

      const wasPrevented = e.defaultPrevented;
      e.preventDefault();
      if (wasPrevented) return;

      isGesturingRef.current = true;
      const rect = el.getBoundingClientRect();
      gestureStartViewport = viewportRef.current;
      gestureStartZoom = viewportRef.current.zoom;

      const mouseX = mousePosRef.current.clientX;
      const mouseY = mousePosRef.current.clientY;
      if (
        mouseX >= rect.left &&
        mouseX <= rect.right &&
        mouseY >= rect.top &&
        mouseY <= rect.bottom
      ) {
        gestureAnchorX = mouseX - rect.left;
        gestureAnchorY = mouseY - rect.top;
      } else {
        gestureAnchorX = rect.width / 2;
        gestureAnchorY = rect.height / 2;
      }
    };

    const onGestureChange = (e: Event) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('#sidebar-container')) return;

      const wasPrevented = e.defaultPrevented;
      e.preventDefault();
      if (wasPrevented) return;

      const ge = e as unknown as { scale: number };
      if (typeof ge.scale !== 'number' || isNaN(ge.scale) || ge.scale <= 0) return;

      const targetZoom = clamp(gestureStartZoom * ge.scale, MIN_ZOOM, MAX_ZOOM);
      const k = targetZoom / gestureStartZoom;
      setViewport({
        x: gestureAnchorX - k * (gestureAnchorX - gestureStartViewport.x),
        y: gestureAnchorY - k * (gestureAnchorY - gestureStartViewport.y),
        zoom: targetZoom,
      });
    };

    const onGestureEnd = (e: Event) => {
      e.preventDefault();
      setTimeout(() => {
        isGesturingRef.current = false;
      }, 60);
    };

    // Attach wheel listener to el
    el.addEventListener('wheel', onWheel, { passive: false });

    // Attach WebKit gesture listeners to document and window
    document.addEventListener('gesturestart', onGestureStart, { passive: false });
    document.addEventListener('gesturechange', onGestureChange, { passive: false });
    document.addEventListener('gestureend', onGestureEnd, { passive: false });
    window.addEventListener('gesturestart', onGestureStart, { passive: false });
    window.addEventListener('gesturechange', onGestureChange, { passive: false });
    window.addEventListener('gestureend', onGestureEnd, { passive: false });

    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      el.removeEventListener('wheel', onWheel);
      document.removeEventListener('gesturestart', onGestureStart);
      document.removeEventListener('gesturechange', onGestureChange);
      document.removeEventListener('gestureend', onGestureEnd);
      window.removeEventListener('gesturestart', onGestureStart);
      window.removeEventListener('gesturechange', onGestureChange);
      window.removeEventListener('gestureend', onGestureEnd);
    };
  }, [setViewport]);

  // Global clipboard copy listener for canvas elements
  useEffect(() => {
    const handleCopy = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      const activeEl = document.activeElement as HTMLElement | null;
      const isInput =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.isContentEditable ||
        Boolean(target?.closest('.ProseMirror')) ||
        activeEl?.tagName === 'INPUT' ||
        activeEl?.tagName === 'TEXTAREA' ||
        activeEl?.isContentEditable ||
        Boolean(activeEl?.closest('.ProseMirror'));

      if (isInput || editingId) return;

      const state = useNotesStore.getState();
      const currentNb = state.notebooks.find((nb) => nb.id === state.activeNotebookId);
      const currentSec = currentNb?.sections.find((s) => s.id === state.activeSectionId);
      if (!currentSec) return;

      const currentSelectedId = useUiStore.getState().selectedId;
      const currentSelectedIds = useUiStore.getState().selectedIds;
      const selectedSet = new Set([
        ...(currentSelectedId ? [currentSelectedId] : []),
        ...currentSelectedIds,
      ]);
      const elementsToCopy = currentSec.elements.filter((el) => selectedSet.has(el.id));
      if (elementsToCopy.length === 0) return;

      e.preventDefault();
      useUiStore.getState().setClipboardElements(elementsToCopy);
      const serialized = JSON.stringify(elementsToCopy);
      e.clipboardData?.setData('application/x-notebook-elements', serialized);

      let plainText: string;
      if (elementsToCopy.length === 1 && elementsToCopy[0].type === 'text') {
        const temp = document.createElement('div');
        temp.innerHTML = elementsToCopy[0].content;
        plainText = temp.textContent || temp.innerText || '';
      } else {
        plainText = `[Notebook Elements (${elementsToCopy.length} items)]`;
      }
      e.clipboardData?.setData('text/plain', plainText);
      rememberCopiedPlainText(plainText);

      window.dispatchEvent(
        new CustomEvent('inkwell-toast', {
          detail: `Copied ${elementsToCopy.length} item${elementsToCopy.length > 1 ? 's' : ''}`,
        })
      );
    };

    window.addEventListener('copy', handleCopy);
    return () => window.removeEventListener('copy', handleCopy);
  }, [editingId]);

  // Space key and Tool/Zoom keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const activeEl = document.activeElement as HTMLElement | null;
      const isInput =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.isContentEditable ||
        Boolean(target?.closest('.ProseMirror')) ||
        activeEl?.tagName === 'INPUT' ||
        activeEl?.tagName === 'TEXTAREA' ||
        activeEl?.isContentEditable ||
        Boolean(activeEl?.closest('.ProseMirror'));

      if (e.code === 'Space' && !isInput && !e.repeat) {
        setIsSpacePressed(true);
      }

      // Escape always cancels an active AI capture — even when an input has focus.
      if (e.key === 'Escape' && (activeTool === 'ai-capture' || aiCaptureDraftRef.current)) {
        e.preventDefault();
        if (aiCaptureDraftRef.current) {
          aiCaptureDraftRef.current = null;
          setAiCaptureDraft(null);
        }
        setActiveTool('select');
        return;
      }

      // Alt+A (⌥A on macOS): send the current selection to the Ask sidebar
      if (!isInput && !e.metaKey && !e.ctrlKey && e.altKey && e.code === 'KeyA') {
        e.preventDefault();
        handleAskSelection();
        return;
      }

      // Quick tool toggle shortcuts: H = Hand tool, V = Select tool, A = Arrow tool
      if (!isInput && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const k = e.key.toLowerCase();
        if (k === 'h' || e.code === 'KeyH') {
          e.preventDefault();
          setActiveTool('hand');
        } else if (k === 'v' || e.code === 'KeyV') {
          e.preventDefault();
          setActiveTool('select');
        } else if (k === 'a' || e.code === 'KeyA') {
          e.preventDefault();
          if (activeTool === 'arrow' && arrowDraftRef.current) {
            // Already drafting: flip between upward and downward curve!
            const nextFlipped = !arrowDraftRef.current.isFlipped;
            arrowDraftRef.current = {
              ...arrowDraftRef.current,
              isFlipped: nextFlipped,
            };
            setArrowDraft((prev) => (prev ? { ...prev, isFlipped: nextFlipped } : null));
          } else {
            setActiveTool('arrow');
          }
        } else if (k === 'r' || e.code === 'KeyR') {
          e.preventDefault();
          setActiveTool('rect');
        } else if (k === 't' || e.code === 'KeyT') {
          // T = Create new text element at viewport center and start typing
          e.preventDefault();
          const container = containerRef.current;
          if (container && onDoubleClickCanvas) {
            const rect = container.getBoundingClientRect();
            const vp = viewportRef.current;
            const canvasX = (rect.width / 2 - vp.x) / vp.zoom;
            const canvasY = (rect.height / 2 - vp.y) / vp.zoom;
            onDoubleClickCanvas(canvasX, canvasY);
          }
        }
      }

      // Keyboard shortcuts per §9.1 and Zoom controls
      if ((e.metaKey || e.ctrlKey) && e.code === 'KeyZ') {
        e.preventDefault();
        if (e.shiftKey) {
          redo();
        } else {
          undo();
        }
      } else if ((e.metaKey || e.ctrlKey) && (e.code === 'Equal' || e.key === '=' || e.key === '+')) {
        e.preventDefault();
        zoomIn();
      } else if ((e.metaKey || e.ctrlKey) && (e.code === 'Minus' || e.key === '-')) {
        e.preventDefault();
        zoomOut();
      } else if ((e.metaKey || e.ctrlKey) && e.code === 'Digit0') {
        e.preventDefault();
        resetViewport();
      } else if (
        (e.metaKey || e.ctrlKey) &&
        (e.code === 'KeyA' || e.key === 'a' || e.key === 'A') &&
        !isInput &&
        !editingId
      ) {
        // Cmd+A / Ctrl+A: Select all canvas elements in the active section
        e.preventDefault();
        const state = useNotesStore.getState();
        const currentNb = state.notebooks.find((nb) => nb.id === state.activeNotebookId);
        const currentSec = currentNb?.sections.find((s) => s.id === state.activeSectionId);
        const allElements = currentSec?.elements || [];
        if (allElements.length > 0) {
          setSelectedIds(allElements.map((el) => el.id));
        }
      } else if (
        (e.metaKey || e.ctrlKey) &&
        (e.code === 'KeyD' || e.key === 'd' || e.key === 'D') &&
        !isInput &&
        !editingId
      ) {
        // Cmd+D / Ctrl+D: Duplicate selected element(s)
        e.preventDefault();
        const state = useNotesStore.getState();
        const currentNb = state.notebooks.find((nb) => nb.id === state.activeNotebookId);
        const currentSec = currentNb?.sections.find((s) => s.id === state.activeSectionId);
        if (!currentSec) return;

        const currentSelectedId = useUiStore.getState().selectedId;
        const currentSelectedIds = useUiStore.getState().selectedIds;
        const selectedSet = new Set([
          ...(currentSelectedId ? [currentSelectedId] : []),
          ...currentSelectedIds,
        ]);
        const elementsToDuplicate = currentSec.elements.filter((el) => selectedSet.has(el.id));
        if (elementsToDuplicate.length === 0) return;

        const maxZ = currentSec.elements.reduce((m, el) => Math.max(m, el.zIndex), 100);
        const offset = 32;

        const duplicatedElements: CanvasElement[] = elementsToDuplicate.map((el, idx) => {
          const newId = crypto.randomUUID();
          const newZ = maxZ + 1 + idx;

          if (el.type === 'arrow') {
            return {
              ...el,
              id: newId,
              startX: el.startX + offset,
              startY: el.startY + offset,
              endX: el.endX + offset,
              endY: el.endY + offset,
              x: el.x + offset,
              y: el.y + offset,
              zIndex: newZ,
            };
          }

          return {
            ...el,
            id: newId,
            x: el.x + offset,
            y: el.y + offset,
            zIndex: newZ,
          };
        });

        addElements(duplicatedElements);
        if (duplicatedElements.length === 1) {
          setSelectedId(duplicatedElements[0].id);
        } else {
          setSelectedIds(duplicatedElements.map((item) => item.id));
        }

        window.dispatchEvent(
          new CustomEvent('inkwell-toast', {
            detail: `Duplicated ${duplicatedElements.length} item${duplicatedElements.length > 1 ? 's' : ''}`,
          })
        );
      } else if (e.key === 'Escape') {
        e.preventDefault();
        if (aiCaptureDraftRef.current) {
          aiCaptureDraftRef.current = null;
          setAiCaptureDraft(null);
        } else if (activeTool === 'ai-capture') {
          setActiveTool('select');
        } else if (arrowDraftRef.current) {
          arrowDraftRef.current = null;
          setArrowDraft(null);
        } else if (rectDraftRef.current) {
          rectDraftRef.current = null;
          setRectDraft(null);
        } else if (marqueeBoxRef.current) {
          isMarqueeDraggingRef.current = false;
          marqueeBoxRef.current = null;
          setMarqueeBox(null);
        } else if (editingId) {
          setEditingId(null);
        } else if (selectedId || selectedIds.length > 0) {
          clearSelection();
        }
      } else if (
        (e.key === 'Backspace' || e.key === 'Delete') &&
        (selectedId || selectedIds.length > 0) &&
        !editingId &&
        !isInput
      ) {
        e.preventDefault();
        const idsToDelete = Array.from(
          new Set([
            ...(selectedId ? [selectedId] : []),
            ...selectedIds,
          ])
        );
        if (idsToDelete.length > 0) {
          deleteElements(idsToDelete);
          clearSelection();
        }
      } else if (
        e.key === 'Escape' &&
        (!isInput || Boolean((e.target as HTMLElement | null)?.closest('[data-ai-panel]')))
      ) {
        // Escape with nothing else to undo: minimize the AI sidebar
        // (only when focus sits on the canvas or inside the AI panel itself —
        // never from other app inputs, e.g. the command palette).
        if (useUiStore.getState().isAiSidebarOpen) {
          useUiStore.getState().setAiSidebarOpen(false);
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        setIsSpacePressed(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [
    editingId,
    selectedId,
    selectedIds,
    activeTool,
    setEditingId,
    setSelectedId,
    setSelectedIds,
    clearSelection,
    deleteElements,
    resetViewport,
    zoomIn,
    zoomOut,
    setActiveTool,
    undo,
    redo,
    onDoubleClickCanvas,
    handleAskSelection,
  ]);

  // Pointer-based pan (Hand tool, Space+drag, or middle-click drag), Arrow drafting, or Rectangle drafting
  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      // AI capture tool: drag a region to screenshot for the AI sidebar
      if (activeTool === 'ai-capture') {
        if (e.button !== 0 || aiCaptureBusyRef.current) return;
        const container = containerRef.current;
        if (!container) return;
        e.preventDefault();
        const rect = container.getBoundingClientRect();
        const coords = screenToCanvas(e.clientX, e.clientY, viewportRef.current, rect);

        clearSelection();
        setEditingId(null);

        const initialDraft = {
          startX: coords.x,
          startY: coords.y,
          currentX: coords.x,
          currentY: coords.y,
        };
        aiCaptureDraftRef.current = initialDraft;
        setAiCaptureDraft(initialDraft);
        e.currentTarget.setPointerCapture(e.pointerId);
        return;
      }

      // Rectangle tool handling: drag to draw, release to commit
      if (activeTool === 'rect' && e.button === 0) {
        const container = containerRef.current;
        if (!container) return;
        e.preventDefault();
        const rect = container.getBoundingClientRect();
        const coords = screenToCanvas(e.clientX, e.clientY, viewportRef.current, rect);

        clearSelection();
        setEditingId(null);

        const initialDraft = {
          startX: coords.x,
          startY: coords.y,
          currentX: coords.x,
          currentY: coords.y,
        };
        rectDraftRef.current = initialDraft;
        setRectDraft(initialDraft);
        e.currentTarget.setPointerCapture(e.pointerId);
        return;
      }

      // Arrow tool handling:
      if (activeTool === 'arrow' && e.button === 0) {
        e.preventDefault();
        const container = containerRef.current;
        if (!container) return;
        const rect = container.getBoundingClientRect();
        const coords = screenToCanvas(e.clientX, e.clientY, viewportRef.current, rect);

        if (!arrowDraftRef.current) {
          // Point 1: start draft
          arrowPointerDownTimeRef.current = Date.now();
          const initialDraft = {
            startX: coords.x,
            startY: coords.y,
            currentX: coords.x,
            currentY: coords.y,
            isFlipped: false,
          };
          arrowDraftRef.current = initialDraft;
          setArrowDraft(initialDraft);
        } else {
          // Point 2: commit arrow in the current flipped/unflipped state
          const draft = arrowDraftRef.current;
          const dist = Math.hypot(coords.x - draft.startX, coords.y - draft.startY);
          if (dist > 8) {
            commitArrow(draft.startX, draft.startY, coords.x, coords.y, draft.isFlipped);
          } else {
            arrowDraftRef.current = null;
            setArrowDraft(null);
          }
        }
        return;
      }

      const isMiddleClick = e.button === 1;
      const isSpaceDrag = isSpacePressed && e.button === 0;
      const isHandToolDrag = activeTool === 'hand' && e.button === 0;

      if (isMiddleClick || isSpaceDrag || isHandToolDrag) {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        setIsPanning(true);
        panStartRef.current = {
          clientX: e.clientX,
          clientY: e.clientY,
          startX: viewportRef.current.x,
          startY: viewportRef.current.y,
        };
        return;
      }

      // Marquee box selection (Select tool + Left click on empty canvas)
      if (activeTool === 'select' && e.button === 0) {
        const container = containerRef.current;
        if (!container) return;
        const rect = container.getBoundingClientRect();
        const coords = screenToCanvas(e.clientX, e.clientY, viewportRef.current, rect);

        isMarqueeDraggingRef.current = true;
        const initialBox = {
          startX: coords.x,
          startY: coords.y,
          currentX: coords.x,
          currentY: coords.y,
        };
        marqueeBoxRef.current = initialBox;
        setMarqueeBox(initialBox);
        e.currentTarget.setPointerCapture(e.pointerId);

        if (!e.shiftKey) {
          clearSelection();
        }
      }
    },
    [isSpacePressed, activeTool, commitArrow, clearSelection, setEditingId]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (activeTool === 'ai-capture' && aiCaptureDraftRef.current) {
        const container = containerRef.current;
        if (!container) return;
        const rect = container.getBoundingClientRect();
        const coords = screenToCanvas(e.clientX, e.clientY, viewportRef.current, rect);
        const updatedDraft = {
          ...aiCaptureDraftRef.current,
          currentX: coords.x,
          currentY: coords.y,
        };
        aiCaptureDraftRef.current = updatedDraft;
        setAiCaptureDraft(updatedDraft);
        return;
      }

      if (activeTool === 'rect' && rectDraftRef.current) {
        const container = containerRef.current;
        if (!container) return;
        const rect = container.getBoundingClientRect();
        const coords = screenToCanvas(e.clientX, e.clientY, viewportRef.current, rect);
        const updatedDraft = {
          ...rectDraftRef.current,
          currentX: coords.x,
          currentY: coords.y,
        };
        rectDraftRef.current = updatedDraft;
        setRectDraft(updatedDraft);
        return;
      }

      if (activeTool === 'arrow' && arrowDraftRef.current) {
        const container = containerRef.current;
        if (!container) return;
        const rect = container.getBoundingClientRect();
        const coords = screenToCanvas(e.clientX, e.clientY, viewportRef.current, rect);
        arrowDraftRef.current = {
          ...arrowDraftRef.current,
          currentX: coords.x,
          currentY: coords.y,
        };
        setArrowDraft((prev) =>
          prev ? { ...prev, currentX: coords.x, currentY: coords.y } : null
        );
        return;
      }

      // Marquee drag selection move
      if (isMarqueeDraggingRef.current && marqueeBoxRef.current) {
        const container = containerRef.current;
        if (!container) return;
        const rect = container.getBoundingClientRect();
        const coords = screenToCanvas(e.clientX, e.clientY, viewportRef.current, rect);

        const updatedBox = {
          ...marqueeBoxRef.current,
          currentX: coords.x,
          currentY: coords.y,
        };
        marqueeBoxRef.current = updatedBox;
        setMarqueeBox(updatedBox);

        // Calculate marquee bounding box in canvas space
        const boxMinX = Math.min(updatedBox.startX, updatedBox.currentX);
        const boxMaxX = Math.max(updatedBox.startX, updatedBox.currentX);
        const boxMinY = Math.min(updatedBox.startY, updatedBox.currentY);
        const boxMaxY = Math.max(updatedBox.startY, updatedBox.currentY);

        const dragDist = Math.hypot(
          updatedBox.currentX - updatedBox.startX,
          updatedBox.currentY - updatedBox.startY
        );

        if (dragDist > 3 && activeSection) {
          const matchedIds: string[] = [];
          for (const el of activeSection.elements) {
            let elMinX = el.x;
            let elMaxX = el.x + (('width' in el && typeof el.width === 'number') ? el.width : 200);
            let elMinY = el.y;
            let elMaxY = el.y + (('height' in el && typeof el.height === 'number' && el.height !== null) ? el.height : 60);

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

            // AABB intersection check: overlap exists if NOT completely outside
            const intersects = !(
              elMaxX < boxMinX ||
              elMinX > boxMaxX ||
              elMaxY < boxMinY ||
              elMinY > boxMaxY
            );

            if (intersects) {
              matchedIds.push(el.id);
            }
          }

          setSelectedIds(matchedIds);
        }
        return;
      }

      if (!isPanning || !panStartRef.current) return;
      const dx = e.clientX - panStartRef.current.clientX;
      const dy = e.clientY - panStartRef.current.clientY;
      setViewport({
        x: panStartRef.current.startX + dx,
        y: panStartRef.current.startY + dy,
      });
    },
    [activeTool, isPanning, setViewport, activeSection, setSelectedIds]
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (activeTool === 'ai-capture') {
        try {
          e.currentTarget.releasePointerCapture(e.pointerId);
        } catch {
          // Pointer may already be released.
        }
        const container = containerRef.current;
        const draft = aiCaptureDraftRef.current;
        aiCaptureDraftRef.current = null;
        setAiCaptureDraft(null);
        if (!container || !draft) return;

        const x = Math.min(draft.startX, draft.currentX);
        const y = Math.min(draft.startY, draft.currentY);
        const width = Math.abs(draft.currentX - draft.startX);
        const height = Math.abs(draft.currentY - draft.startY);
        const vp = viewportRef.current;

        if (width * vp.zoom < 32 || height * vp.zoom < 32) {
          window.dispatchEvent(
            new CustomEvent('inkwell-toast', { detail: 'Capture region too small' })
          );
          setActiveTool('select');
          return;
        }

        aiCaptureBusyRef.current = true;
        setIsCapturingRegion(true);
        void (async () => {
          try {
            const shot = await captureCanvasRegion(container, { x, y, width, height }, vp);
            const threadId = await useAiStore
              .getState()
              .startThreadFromCapture(shot.blob, shot.width, shot.height);
            useAiStore.getState().setActiveThread(threadId);
            useUiStore.getState().setAiSidebarOpen(true);
            setActiveTool('select');
            window.dispatchEvent(
              new CustomEvent('inkwell-toast', {
                detail: 'Region captured — ask the AI anything',
              })
            );
          } catch (err) {
            console.error('AI region capture failed:', err);
            window.dispatchEvent(
              new CustomEvent('inkwell-toast', {
                detail: 'Could not capture that region. Try again.',
              })
            );
            setActiveTool('select');
          } finally {
            aiCaptureBusyRef.current = false;
            setIsCapturingRegion(false);
          }
        })();
        return;
      }

      if (activeTool === 'rect' && rectDraftRef.current) {
        try {
          e.currentTarget.releasePointerCapture(e.pointerId);
        } catch {
          // Pointer may already be released.
        }

        const container = containerRef.current;
        const draft = rectDraftRef.current;
        rectDraftRef.current = null;
        setRectDraft(null);

        if (container) {
          const rect = container.getBoundingClientRect();
          const coords = screenToCanvas(e.clientX, e.clientY, viewportRef.current, rect);
          const width = Math.abs(coords.x - draft.startX);
          const height = Math.abs(coords.y - draft.startY);
          const zoom = viewportRef.current.zoom;
          // Require a few screen pixels of movement so a plain click doesn't create a shape.
          if (width * zoom >= MIN_RECT_DRAG || height * zoom >= MIN_RECT_DRAG) {
            commitRect(draft.startX, draft.startY, coords.x, coords.y);
          }
        }
        return;
      }

      if (activeTool === 'arrow' && arrowDraftRef.current) {
        const duration = Date.now() - arrowPointerDownTimeRef.current;
        const container = containerRef.current;
        if (container) {
          const rect = container.getBoundingClientRect();
          const coords = screenToCanvas(e.clientX, e.clientY, viewportRef.current, rect);
          const draft = arrowDraftRef.current;
          const dist = Math.hypot(coords.x - draft.startX, coords.y - draft.startY);
          // Drag-and-release workflow (if user clicked & dragged without releasing)
          if (duration > 160 && dist > 15) {
            commitArrow(draft.startX, draft.startY, coords.x, coords.y, draft.isFlipped);
            return;
          }
        }
      }

      if (isMarqueeDraggingRef.current) {
        try {
          e.currentTarget.releasePointerCapture(e.pointerId);
        } catch {}
        if (marqueeBoxRef.current) {
          const dist = Math.hypot(
            marqueeBoxRef.current.currentX - marqueeBoxRef.current.startX,
            marqueeBoxRef.current.currentY - marqueeBoxRef.current.startY
          );
          if (dist > 5) {
            justFinishedMarqueeRef.current = true;
          }
        }
        isMarqueeDraggingRef.current = false;
        marqueeBoxRef.current = null;
        setMarqueeBox(null);
      }

      if (isPanning) {
        try {
          e.currentTarget.releasePointerCapture(e.pointerId);
        } catch {
          // pointer might already be released
        }
        setIsPanning(false);
        panStartRef.current = null;
      }
    },
    [activeTool, isPanning, commitArrow, commitRect, setActiveTool]
  );

  // Click empty canvas: deselect and exit edit mode
  const handleCanvasClick = (e: React.MouseEvent) => {
    if (justCommittedArrowRef.current) {
      justCommittedArrowRef.current = false;
      return;
    }
    if (justCommittedRectRef.current) {
      justCommittedRectRef.current = false;
      return;
    }
    if (justFinishedMarqueeRef.current) {
      justFinishedMarqueeRef.current = false;
      return;
    }
    if (activeTool === 'arrow' || activeTool === 'rect' || activeTool === 'ai-capture') return;
    if (e.target === containerRef.current || (e.target as HTMLElement).id === 'canvas-world-layer') {
      clearSelection();
      setEditingId(null);
    }
  };

  // Double click empty canvas: invoke callback with canvas-space coordinates (only in select mode)
  const handleDoubleClick = (e: React.MouseEvent) => {
    if (activeTool !== 'select') return;

    if (
      e.target === containerRef.current ||
      (e.target as HTMLElement).id === 'canvas-world-layer'
    ) {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const coords = screenToCanvas(e.clientX, e.clientY, viewportRef.current, rect);
      onDoubleClickCanvas?.(coords.x, coords.y);
    }
  };

  // Right-click / two-finger click: open the custom canvas context menu instead of
  // the native WebView menu (Reload / Inspect Element).
  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const container = containerRef.current;
    if (!container) return;

    const target = e.target as HTMLElement;
    const node = target.closest<HTMLElement>('[data-element-id]');
    const state = useNotesStore.getState();
    const nb = state.notebooks.find((n) => n.id === state.activeNotebookId);
    const sec = nb?.sections.find((s) => s.id === state.activeSectionId);
    const element =
      node?.dataset.elementId != null
        ? sec?.elements.find((el) => el.id === node.dataset.elementId) ?? null
        : null;

    if (element) {
      const ui = useUiStore.getState();
      if (ui.selectedId !== element.id && !ui.selectedIds.includes(element.id)) {
        ui.setSelectedId(element.id);
      }
    } else if (
      target === container ||
      target.id === 'canvas-world-layer'
    ) {
      // Empty canvas: clear any current selection.
      useUiStore.getState().clearSelection();
      useUiStore.getState().setEditingId(null);
    }

    const rect = container.getBoundingClientRect();
    const coords = screenToCanvas(e.clientX, e.clientY, viewportRef.current, rect);

    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      elementId: element?.id ?? null,
      canvasX: coords.x,
      canvasY: coords.y,
    });
  };

  const contextMenuElement = contextMenu?.elementId
    ? activeSection?.elements.find((el) => el.id === contextMenu.elementId) ?? null
    : null;

  const gridStyle = getDotGridStyle(viewport);

  const cursorClass = isPanning
    ? 'cursor-grabbing'
    : activeTool === 'hand'
    ? 'cursor-grab'
    : isSpacePressed
    ? 'cursor-grab'
    : activeTool === 'ai-capture'
    ? 'cursor-crosshair'
    : activeTool === 'arrow'
    ? 'cursor-crosshair'
    : activeTool === 'rect'
    ? 'cursor-crosshair'
    : 'cursor-default';

  return (
    <div
      ref={containerRef}
      id="infinite-canvas-container"
      tabIndex={-1}
      onClick={handleCanvasClick}
      onDoubleClick={handleDoubleClick}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onContextMenu={handleContextMenu}
      className={`relative w-full h-full overflow-hidden select-none outline-none ${cursorClass}`}
      style={{
        ...gridStyle,
        backgroundColor: 'var(--color-canvas)',
      }}
    >
      <WorldLayer viewport={viewport}>
        {/* Block all card interactions while the capture crosshair is active.
            Without this, card elements intercept pointer events and override
            the crosshair cursor with their own cursor-grab style. */}
        <div className={activeTool === 'ai-capture' ? 'pointer-events-none' : undefined}>
          {children}
        </div>
        {arrowDraft && (() => {
          const { startX, startY, currentX, currentY, isFlipped } = arrowDraft;
          const dx = currentX - startX;
          const dy = currentY - startY;
          const dist = Math.hypot(dx, dy);
          const safeDist = Math.max(dist, 1);

          const nx = -dy / safeDist;
          const ny = dx / safeDist;
          const baseH = Math.max(28, Math.min(260, dist * 0.28));
          const flip = isFlipped ? -1 : 1;
          const h = flip * baseH;
          const cx = (startX + currentX) / 2 + nx * h;
          const cy = (startY + currentY) / 2 + ny * h;

          const headLen = 11.5;
          const headWidth = 4.2;

          const vStartX = startX - cx;
          const vStartY = startY - cy;
          const lenStart = Math.hypot(vStartX, vStartY) || 1;
          const uxStart = vStartX / lenStart;
          const uyStart = vStartY / lenStart;
          const vxStart = -uyStart;
          const vyStart = uxStart;

          const startTipX = startX;
          const startTipY = startY;
          const startBaseX = startTipX - uxStart * headLen;
          const startBaseY = startTipY - uyStart * headLen;
          const startLeftX = startBaseX + vxStart * headWidth;
          const startLeftY = startBaseY + vyStart * headWidth;
          const startRightX = startBaseX - vxStart * headWidth;
          const startRightY = startBaseY - vyStart * headWidth;

          const pathStartX = startTipX - uxStart * (headLen - 2.0);
          const pathStartY = startTipY - uyStart * (headLen - 2.0);

          const draftColor = isDark ? '#ECECEC' : '#000000';

          return (
            <svg
              className="overflow-visible pointer-events-none"
              style={{ position: 'absolute', top: 0, left: 0, zIndex: 9999 }}
            >
              {/* Stretching curved shaft */}
              <path
                d={`M ${pathStartX} ${pathStartY} Q ${cx} ${cy} ${currentX} ${currentY}`}
                fill="none"
                stroke={draftColor}
                strokeWidth={1.8}
                strokeLinecap="round"
              />
              {/* Arrowhead at Start point */}
              <polygon
                points={`${startTipX},${startTipY} ${startLeftX},${startLeftY} ${startRightX},${startRightY}`}
                fill={draftColor}
              />
              {/* Subtle endpoint guide circle */}
              <circle cx={currentX} cy={currentY} r={3.5} fill={draftColor} fillOpacity={0.7} />
            </svg>
          );
        })()}

        {/* Rectangle draft preview */}
        {rectDraft && (() => {
          const x = Math.min(rectDraft.startX, rectDraft.currentX);
          const y = Math.min(rectDraft.startY, rectDraft.currentY);
          const width = Math.abs(rectDraft.currentX - rectDraft.startX);
          const height = Math.abs(rectDraft.currentY - rectDraft.startY);
          if (width < 1 && height < 1) return null;

          const draftColor = resolveShapeColor(shapeColorDefault, isDark);
          const radius = Math.min(DEFAULT_RECT_RADIUS, width / 2, height / 2);

          return (
            <div
              className="pointer-events-none absolute"
              style={{
                left: `${x}px`,
                top: `${y}px`,
                width: `${width}px`,
                height: `${height}px`,
                borderRadius: radius,
                border: `2px solid ${draftColor}`,
                backgroundColor: withAlpha(draftColor, isDark ? 0.14 : 0.08),
                zIndex: 9999,
              }}
            />
          );
        })()}

        {/* Marquee Selection Box (Figma Style) */}
        {marqueeBox && (() => {
          const x = Math.min(marqueeBox.startX, marqueeBox.currentX);
          const y = Math.min(marqueeBox.startY, marqueeBox.currentY);
          const width = Math.abs(marqueeBox.currentX - marqueeBox.startX);
          const height = Math.abs(marqueeBox.currentY - marqueeBox.startY);
          if (width < 2 && height < 2) return null;
          return (
            <div
              className="absolute pointer-events-none rounded-sm border border-blue-500/80 bg-blue-500/15 shadow-[0_0_0_1px_rgba(59,130,246,0.1)]"
              style={{
                left: `${x}px`,
                top: `${y}px`,
                width: `${width}px`,
                height: `${height}px`,
                zIndex: 9998,
              }}
            />
          );
        })()}
      </WorldLayer>

      {/* AI capture overlay: dims everything outside the dragged region.
          data-ai-capture-hide removes these from the capture raster. */}
      {aiCaptureDraft && (() => {
        const x = Math.min(aiCaptureDraft.startX, aiCaptureDraft.currentX) * viewport.zoom + viewport.x;
        const y = Math.min(aiCaptureDraft.startY, aiCaptureDraft.currentY) * viewport.zoom + viewport.y;
        const width = Math.abs(aiCaptureDraft.currentX - aiCaptureDraft.startX) * viewport.zoom;
        const height = Math.abs(aiCaptureDraft.currentY - aiCaptureDraft.startY) * viewport.zoom;
        const draftColor = isDark ? 'rgba(236, 236, 236, 0.9)' : 'rgba(31, 41, 55, 0.9)';
        return (
          <div
            data-ai-capture-hide
            className="pointer-events-none absolute inset-0 z-[9990]"
          >
            <div
              className="absolute rounded-md"
              style={{
                left: `${x}px`,
                top: `${y}px`,
                width: `${width}px`,
                height: `${height}px`,
                boxShadow: '0 0 0 100000px rgba(17, 24, 39, 0.35)',
                border: `1.5px dashed ${draftColor}`,
                background: isDark
                  ? 'rgba(236, 236, 236, 0.05)'
                  : 'rgba(31, 41, 55, 0.05)',
              }}
            >
              {width > 64 && height > 34 && (
                <span className="absolute left-2 top-2 rounded-full bg-gray-900/85 px-2 py-0.5 text-[10px] font-medium text-white whitespace-nowrap">
                  {Math.round(width / viewport.zoom)} × {Math.round(height / viewport.zoom)}
                </span>
              )}
            </div>
          </div>
        );
      })()}

      {isCapturingRegion && (
        <div
          data-ai-capture-hide
          className="pointer-events-none absolute left-1/2 top-6 -translate-x-1/2 z-[9991] px-4 py-2 rounded-full bg-gray-900/90 dark:bg-[#1E1E1E]/95 text-white dark:text-gray-100 text-xs font-medium backdrop-blur-xl shadow-2xl border border-white/10 flex items-center gap-2.5 animate-fade-in"
        >
          <span className="w-2 h-2 rounded-full bg-white animate-ping shrink-0" />
          <span>Capturing region…</span>
        </div>
      )}

      {contextMenu && (
        <CanvasContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          element={contextMenuElement}
          canvasX={contextMenu.canvasX}
          canvasY={contextMenu.canvasY}
          onClose={() => setContextMenu(null)}
          onAskSelection={handleAskSelection}
          onCreateNote={(x, y) => {
            setContextMenu(null);
            onDoubleClickCanvas?.(x, y);
          }}
        />
      )}
    </div>
  );
};
