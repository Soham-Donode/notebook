import {
  type FC,
  memo,
  useRef,
  useEffect,
  useCallback,
} from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { TextStyleKit } from '@tiptap/extension-text-style';
import { GripHorizontal } from 'lucide-react';
import { TextElement } from '../../types';
import { useNotesStore } from '../../store/useNotesStore';
import { useUiStore } from '../../store/useUiStore';
import { ElementQuickActions } from './ElementQuickActions';

interface TextCardProps {
  element: TextElement;
}

const TextCardInner: FC<TextCardProps> = ({ element }) => {
  const cardRef = useRef<HTMLDivElement>(null);
  const selectedId = useUiStore((state) => state.selectedId);
  const selectedIds = useUiStore((state) => state.selectedIds);
  const editingId = useUiStore((state) => state.editingId);
  const setSelectedId = useUiStore((state) => state.setSelectedId);
  const setEditingId = useUiStore((state) => state.setEditingId);
  const activeTool = useUiStore((state) => state.activeTool);

  const updateElement = useNotesStore((state) => state.updateElement);
  const moveElement = useNotesStore((state) => state.moveElement);
  const moveElements = useNotesStore((state) => state.moveElements);
  const deleteElement = useNotesStore((state) => state.deleteElement);

  const isSelected = selectedId === element.id || selectedIds.includes(element.id);
  const isEditing = editingId === element.id;

  // Track position using refs for 120fps hardware-accelerated drag without React re-render lag
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

  // Resize handling
  const textBodyRef = useRef<HTMLDivElement>(null);
  const isResizingRef = useRef(false);
  const resizeModeRef = useRef<'width' | 'scale'>('width');
  const resizeStartRef = useRef<{
    clientX: number;
    clientY: number;
    startWidth: number;
    startHeight: number;
    startFontSize: number;
  } | null>(null);
  const currentWidthRef = useRef(element.width || 340);
  const currentFontSizeRef = useRef(element.fontSize || 18);

  // Sync external position, width, and font size updates
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
      const w = element.width || 340;
      currentWidthRef.current = w;
      if (cardRef.current) {
        cardRef.current.style.width = `${w}px`;
      }
    }
  }, [element.width]);

  useEffect(() => {
    if (!isResizingRef.current) {
      const fs = element.fontSize || 18;
      currentFontSizeRef.current = fs;
      if (textBodyRef.current) {
        textBodyRef.current.style.fontSize = `${fs}px`;
      }
    }
  }, [element.fontSize]);

  const editor = useEditor({
    extensions: [StarterKit, TextStyleKit],
    content: element.content,
    editable: isEditing,
    onUpdate: ({ editor: ed }) => {
      updateElement(element.id, { content: ed.getHTML() }, false);
    },
  });

  useEffect(() => {
    if (editor) {
      editor.setEditable(isEditing);
      if (isEditing) {
        editor.commands.focus('end');
      }
    }
  }, [editor, isEditing]);

  // Listen for toolbar bold and color actions
  useEffect(() => {
    const onToggleBold = (e: Event) => {
      const customEv = e as CustomEvent<{ id?: string; isBold?: boolean }>;
      if (!editor) return;
      if (customEv.detail?.id && customEv.detail.id !== element.id) return;
      if (!isEditing && selectedId !== element.id) return;

      editor.chain().focus().toggleBold().run();
    };

    const onSetColor = (e: Event) => {
      const customEv = e as CustomEvent<{ id?: string; color?: string }>;
      if (!editor) return;
      if (customEv.detail?.id && customEv.detail.id !== element.id) return;
      if (!isEditing && selectedId !== element.id) return;

      const col = customEv.detail?.color;
      if (col) {
        editor.chain().focus().setColor(col).run();
      } else {
        editor.chain().focus().unsetColor().run();
      }
    };

    window.addEventListener('inkwell-text-bold', onToggleBold);
    window.addEventListener('inkwell-text-color', onSetColor);
    return () => {
      window.removeEventListener('inkwell-text-bold', onToggleBold);
      window.removeEventListener('inkwell-text-color', onSetColor);
    };
  }, [editor, element.id, isEditing, selectedId]);

  const handleBlur = useCallback(() => {
    if (editor) {
      const isEmpty = editor.isEmpty || editor.getText().trim() === '';
      if (isEmpty) {
        deleteElement(element.id);
        if (selectedId === element.id) setSelectedId(null);
        if (editingId === element.id) setEditingId(null);
      } else {
        setEditingId(null);
      }
    }
  }, [editor, deleteElement, element.id, selectedId, editingId, setSelectedId, setEditingId]);

  // Smooth drag handling (supports dragging single or multiple selected elements)
  const handlePointerDown = (e: React.PointerEvent) => {
    if (activeTool === 'hand' || activeTool === 'arrow') return;
    e.stopPropagation();

    const { selectedIds, selectedId } = useUiStore.getState();
    const isPartOfMultiSelect = selectedIds.includes(element.id) && selectedIds.length > 1;

    if (!isPartOfMultiSelect && selectedId !== element.id) {
      setSelectedId(element.id);
    }

    if (e.button !== 0) return;

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
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDraggingRef.current || !dragStartRef.current) return;

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
        // Ignored
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

  // Resize pointer event handlers (supporting width wrapping and corner font scaling)
  const handleResizePointerDown = (e: React.PointerEvent, mode: 'width' | 'scale' = 'width') => {
    if (activeTool === 'hand') return;
    e.stopPropagation();
    e.preventDefault();
    if (e.button !== 0) return;

    e.currentTarget.setPointerCapture(e.pointerId);
    isResizingRef.current = true;
    resizeModeRef.current = mode;

    const state = useNotesStore.getState();
    const activeNb = state.notebooks.find((n) => n.id === state.activeNotebookId);
    const activeSec = activeNb?.sections.find((s) => s.id === state.activeSectionId);
    const zoom = activeSec?.viewport.zoom ?? 1;

    const currentHeight = cardRef.current?.getBoundingClientRect().height ?? 60;

    resizeStartRef.current = {
      clientX: e.clientX,
      clientY: e.clientY,
      startWidth: currentWidthRef.current,
      startHeight: currentHeight / zoom,
      startFontSize: currentFontSizeRef.current,
    };
  };

  const handleResizePointerMove = (e: React.PointerEvent) => {
    if (!isResizingRef.current || !resizeStartRef.current) return;
    e.stopPropagation();

    const state = useNotesStore.getState();
    const activeNb = state.notebooks.find((n) => n.id === state.activeNotebookId);
    const activeSec = activeNb?.sections.find((s) => s.id === state.activeSectionId);
    const zoom = activeSec?.viewport.zoom ?? 1;

    const dxCanvas = (e.clientX - resizeStartRef.current.clientX) / zoom;
    const dyCanvas = (e.clientY - resizeStartRef.current.clientY) / zoom;

    if (resizeModeRef.current === 'scale') {
      const startW = resizeStartRef.current.startWidth;
      const startH = Math.max(resizeStartRef.current.startHeight, 40);
      const startSize = resizeStartRef.current.startFontSize;

      // Diagonal drag progress smoothly scales text font size and card width together
      const progress = (dxCanvas / startW + dyCanvas / startH) / 1.4;
      const scaleFactor = Math.max(0.25, 1 + progress);
      const nextWidth = Math.max(100, Math.round(startW * scaleFactor));
      const nextFontSize = Math.max(10, Math.min(160, Math.round(startSize * scaleFactor)));

      currentWidthRef.current = nextWidth;
      currentFontSizeRef.current = nextFontSize;

      if (cardRef.current) {
        cardRef.current.style.width = `${nextWidth}px`;
      }
      if (textBodyRef.current) {
        textBodyRef.current.style.fontSize = `${nextFontSize}px`;
      }
    } else {
      // Width-only adjustment (word wrapping)
      const nextWidth = Math.max(140, Math.round(resizeStartRef.current.startWidth + dxCanvas));
      currentWidthRef.current = nextWidth;
      if (cardRef.current) {
        cardRef.current.style.width = `${nextWidth}px`;
      }
    }
  };

  const handleResizePointerUp = (e: React.PointerEvent) => {
    if (isResizingRef.current) {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // Ignored
      }
      isResizingRef.current = false;
      const mode = resizeModeRef.current;
      resizeStartRef.current = null;

      if (mode === 'scale') {
        updateElement(
          element.id,
          { width: currentWidthRef.current, fontSize: currentFontSizeRef.current },
          true
        );
      } else {
        updateElement(element.id, { width: currentWidthRef.current }, true);
      }
    }
  };

  const handleCardPointerDown = (e: React.PointerEvent) => {
    if (activeTool === 'hand' || activeTool === 'arrow') return;
    if (isEditing) return;
    e.stopPropagation();

    const { selectedIds, selectedId } = useUiStore.getState();
    const isPartOfMultiSelect = selectedIds.includes(element.id) && selectedIds.length > 1;
    if (!isPartOfMultiSelect && selectedId !== element.id) {
      setSelectedId(element.id);
    }
  };

  const handleCardDoubleClick = (e: React.MouseEvent) => {
    if (activeTool === 'hand') return;
    e.stopPropagation();
    setSelectedId(element.id);
    setEditingId(element.id);
  };

  return (
    <div
      ref={cardRef}
      id={`card-${element.id}`}
      data-element-id={element.id}
      onPointerDown={handleCardPointerDown}
      onDoubleClick={handleCardDoubleClick}
      className={`group absolute select-none bg-transparent transition-shadow duration-100 ${
        isSelected || isEditing
          ? 'outline-1 outline-dashed outline-gray-400/80 dark:outline-gray-500/80 rounded-xl'
          : 'hover:outline-1 hover:outline-dashed hover:outline-gray-300/60 dark:hover:outline-gray-600/60 rounded-xl'
      }`}
      style={{
        transform: `translate(${element.x}px, ${element.y}px)`,
        width: element.width || 340,
        zIndex: element.zIndex,
      }}
    >
      {/* OneNote style minimal drag grip bar above the text note */}
      <div
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        className={`absolute -top-9 left-0 right-0 h-7 flex items-center justify-between px-1.5 cursor-grab active:cursor-grabbing transition-opacity rounded-t-lg ${
          isSelected || isEditing ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
        }`}
        style={{ pointerEvents: 'auto' }}
      >
        <div className="flex items-center gap-1 px-0.5 text-gray-500 dark:text-gray-400 hover:text-black dark:hover:text-white transition shrink-0">
          <GripHorizontal size={14} />
          <span className="text-[10px] uppercase font-mono tracking-wider text-gray-400 dark:text-gray-500">Note</span>
        </div>

        <ElementQuickActions element={element} />
      </div>

      {/* Transparent Text Body (Microsoft OneNote seamless style) */}
      <div
        ref={textBodyRef}
        className="p-2 cursor-text text-gray-900 dark:text-[#ECECEC] leading-relaxed outline-none"
        onBlur={handleBlur}
        style={{
          fontFamily: element.fontFamily || 'Comic Sans MS, Comic Neue, cursive, sans-serif',
          fontSize: `${element.fontSize || 18}px`,
          color: element.color || undefined,
          fontWeight: element.isBold ? 'bold' : 'normal',
        }}
      >
        <EditorContent editor={editor} />
      </div>

      {/* Resize Handles (Right Edge + Bottom-Right Corner) */}
      {(isSelected || isEditing) && (
        <>
          {/* Right edge resize bar (Width wrapping) */}
          <div
            onPointerDown={(e) => handleResizePointerDown(e, 'width')}
            onPointerMove={handleResizePointerMove}
            onPointerUp={handleResizePointerUp}
            onPointerCancel={handleResizePointerUp}
            title="Drag to resize width"
            className="absolute top-2 bottom-2 -right-1.5 w-3 cursor-ew-resize flex items-center justify-center group/resize z-20"
            style={{ pointerEvents: 'auto' }}
          >
            <div className="w-1 h-6 rounded-full bg-gray-400/40 dark:bg-gray-500/40 group-hover/resize:bg-black dark:group-hover/resize:bg-white group-hover/resize:scale-y-125 transition-all" />
          </div>

          {/* Bottom-right corner handle (Right lower dot: Scales text font size & card smoothly) */}
          <div
            onPointerDown={(e) => handleResizePointerDown(e, 'scale')}
            onPointerMove={handleResizePointerMove}
            onPointerUp={handleResizePointerUp}
            onPointerCancel={handleResizePointerUp}
            title="Drag corner to smoothly scale text & font size"
            className="absolute -bottom-1.5 -right-1.5 w-4 h-4 cursor-nwse-resize flex items-center justify-center group/corner z-20"
            style={{ pointerEvents: 'auto' }}
          >
            <div className="w-2.5 h-2.5 rounded-full bg-white dark:bg-[#262626] border-[1.5px] border-gray-600 dark:border-gray-300 group-hover/corner:border-black dark:group-hover/corner:border-white group-hover/corner:scale-125 transition-all shadow-xs" />
          </div>
        </>
      )}
    </div>
  );
};

export const TextCard = memo(TextCardInner, (prev, next) => {
  const pe = prev.element;
  const ne = next.element;
  return (
    pe.id === ne.id &&
    pe.x === ne.x &&
    pe.y === ne.y &&
    pe.width === ne.width &&
    pe.height === ne.height &&
    pe.content === ne.content &&
    pe.fontFamily === ne.fontFamily &&
    pe.fontSize === ne.fontSize &&
    pe.color === ne.color &&
    pe.isBold === ne.isBold &&
    pe.zIndex === ne.zIndex
  );
});
