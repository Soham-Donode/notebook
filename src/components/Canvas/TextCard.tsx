import {
  type FC,
  memo,
  useRef,
  useState,
  useEffect,
  useCallback,
} from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { TextStyleKit } from '@tiptap/extension-text-style';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { Placeholder } from '@tiptap/extensions';
import type { Editor } from '@tiptap/core';
import {
  Bold,
  Check,
  Code,
  Eraser,
  GripHorizontal,
  Heading1,
  Heading2,
  Italic,
  List,
  ListChecks,
  ListOrdered,
  Quote,
  Strikethrough,
  Underline,
} from 'lucide-react';
import { TextElement } from '../../types';
import { useNotesStore } from '../../store/useNotesStore';
import { useUiStore } from '../../store/useUiStore';
import { ElementQuickActions } from './ElementQuickActions';

interface TextCardProps {
  element: TextElement;
}

/** How long typing stays local before it is written to the (persisted) store. */
const CONTENT_COMMIT_DELAY = 140;

const BAR_BUTTON =
  'w-6 h-6 rounded-md flex items-center justify-center transition cursor-pointer active:scale-90';
const BAR_BUTTON_ON = 'bg-gray-900 text-white dark:bg-white dark:text-black';
const BAR_BUTTON_OFF =
  'text-gray-600 dark:text-gray-300 hover:bg-black/[0.06] dark:hover:bg-white/[0.12]';

/** Compact formatting row shown above a note while it is being edited. */
const NoteFormatBar: FC<{ editor: Editor | null; onDone: () => void; onAction: () => void }> = ({
  editor,
  onDone,
  onAction,
}) => {
  if (!editor) return null;

  const active = (name: string, attrs?: Record<string, unknown>) => editor.isActive(name, attrs);
  const run = (fn: () => void) => () => {
    fn();
    editor.commands.focus();
    // Marks and node types can change without changing the doc (e.g. toggling
    // bold on an empty selection), so refresh the bar's active states ourselves.
    onAction();
  };
  const btnClass = (isOn: boolean) => `${BAR_BUTTON} ${isOn ? BAR_BUTTON_ON : BAR_BUTTON_OFF}`;

  return (
    <div
      data-note-format-bar
      // Keep focus in the editor so pressing a button never blurs (and possibly
      // deletes) the note we are editing.
      onMouseDown={(e) => e.preventDefault()}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      className="absolute -top-[70px] left-0 z-30 flex items-center gap-0.5 p-1 rounded-xl bg-white/95 dark:bg-[#1E1E1E]/95 backdrop-blur-xl border border-black/[0.08] dark:border-white/[0.12] shadow-[0_10px_26px_rgba(0,0,0,0.18)] dark:shadow-[0_10px_26px_rgba(0,0,0,0.55)] animate-fade-in"
    >
      <button
        type="button"
        title="Bold (⌘B)"
        onClick={run(() => editor.chain().toggleBold().run())}
        className={btnClass(active('bold'))}
      >
        <Bold size={13} />
      </button>
      <button
        type="button"
        title="Italic (⌘I)"
        onClick={run(() => editor.chain().toggleItalic().run())}
        className={btnClass(active('italic'))}
      >
        <Italic size={13} />
      </button>
      <button
        type="button"
        title="Underline (⌘U)"
        onClick={run(() => editor.chain().toggleUnderline().run())}
        className={btnClass(active('underline'))}
      >
        <Underline size={13} />
      </button>
      <button
        type="button"
        title="Strikethrough"
        onClick={run(() => editor.chain().toggleStrike().run())}
        className={btnClass(active('strike'))}
      >
        <Strikethrough size={13} />
      </button>
      <button
        type="button"
        title="Inline code"
        onClick={run(() => editor.chain().toggleCode().run())}
        className={btnClass(active('code'))}
      >
        <Code size={13} />
      </button>

      <span className="w-px h-4 mx-0.5 bg-black/10 dark:bg-white/15 shrink-0" />

      <button
        type="button"
        title="Heading 1 (type # at the start of a line)"
        onClick={run(() => editor.chain().toggleHeading({ level: 1 }).run())}
        className={btnClass(active('heading', { level: 1 }))}
      >
        <Heading1 size={13} />
      </button>
      <button
        type="button"
        title="Heading 2 (type ## at the start of a line)"
        onClick={run(() => editor.chain().toggleHeading({ level: 2 }).run())}
        className={btnClass(active('heading', { level: 2 }))}
      >
        <Heading2 size={13} />
      </button>
      <button
        type="button"
        title="Bullet list (type - or * at the start of a line)"
        onClick={run(() => editor.chain().toggleBulletList().run())}
        className={btnClass(active('bulletList'))}
      >
        <List size={13} />
      </button>
      <button
        type="button"
        title="Numbered list (type 1. at the start of a line)"
        onClick={run(() => editor.chain().toggleOrderedList().run())}
        className={btnClass(active('orderedList'))}
      >
        <ListOrdered size={13} />
      </button>
      <button
        type="button"
        title="Checklist (type [] at the start of a line)"
        onClick={run(() => editor.chain().toggleTaskList().run())}
        className={btnClass(active('taskList'))}
      >
        <ListChecks size={13} />
      </button>
      <button
        type="button"
        title="Quote (type > at the start of a line)"
        onClick={run(() => editor.chain().toggleBlockquote().run())}
        className={btnClass(active('blockquote'))}
      >
        <Quote size={13} />
      </button>

      <span className="w-px h-4 mx-0.5 bg-black/10 dark:bg-white/15 shrink-0" />

      <button
        type="button"
        title="Clear formatting"
        onClick={run(() => editor.chain().unsetAllMarks().clearNodes().run())}
        className={`${BAR_BUTTON} ${BAR_BUTTON_OFF}`}
      >
        <Eraser size={13} />
      </button>
      <button
        type="button"
        title="Done (Esc)"
        onClick={onDone}
        className={`${BAR_BUTTON} ${BAR_BUTTON_ON}`}
      >
        <Check size={13} />
      </button>
    </div>
  );
};

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

  // Editor bookkeeping
  const editorRef = useRef<Editor | null>(null);
  const hasTypedRef = useRef(false);
  const pendingHtmlRef = useRef<string | null>(null);
  const lastCommittedHtmlRef = useRef(element.content);
  const flushTimerRef = useRef<number | null>(null);
  const pendingCaretRef = useRef<{ x: number; y: number } | null>(null);
  const wasEditingRef = useRef(false);
  // One undo entry per editing session, taken lazily on the first real change.
  const snapshotTakenRef = useRef(false);
  // Bumped after a toolbar command so the format bar re-reads editor.isActive().
  const [, refreshFormatBar] = useState(0);

  /**
   * Writes the editor HTML to the store. Content changes never push an undo
   * snapshot: the snapshot for the whole editing session is taken once, when
   * editing starts, so a note edit is a single undo step.
   */
  const commitContent = useCallback(
    (html: string) => {
      if (html === lastCommittedHtmlRef.current) return;

      const store = useNotesStore.getState();
      const notebook = store.notebooks.find((nb) => nb.id === store.activeNotebookId);
      const section = notebook?.sections.find((sec) => sec.id === store.activeSectionId);
      // Never write into a different section than the one this note lives in.
      if (!section?.elements.some((el) => el.id === element.id)) return;

      lastCommittedHtmlRef.current = html;
      store.updateElement(element.id, { content: html }, false);
    },
    [element.id]
  );

  const flushPending = useCallback(() => {
    if (flushTimerRef.current !== null) {
      window.clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    const html = pendingHtmlRef.current;
    pendingHtmlRef.current = null;
    if (html !== null) commitContent(html);
  }, [commitContent]);

  const exitEditing = useCallback(() => {
    flushPending();
    useUiStore.getState().setEditingId(null);
    editorRef.current?.commands.blur();
  }, [flushPending]);

  const exitEditingRef = useRef(exitEditing);
  exitEditingRef.current = exitEditing;

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: { openOnClick: false, autolink: true },
      }),
      TextStyleKit,
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({
        placeholder: 'Write something…',
        showOnlyWhenEditable: true,
      }),
    ],
    content: element.content,
    editable: isEditing,
    editorProps: {
      attributes: {
        class: 'notebook-note',
        spellcheck: 'true',
        autocorrect: 'on',
        autocapitalize: 'sentences',
      },
      handleKeyDown(_view, event) {
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          exitEditingRef.current();
          return true;
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          exitEditingRef.current();
          return true;
        }
        // Tab indents list items (ListKeymap); everywhere else keep focus in
        // the note instead of tabbing to app chrome.
        if (event.key === 'Tab' && !event.shiftKey) {
          const current = editorRef.current;
          if (current?.isActive('listItem') || current?.isActive('taskItem')) return false;
          event.preventDefault();
          return true;
        }
        return false;
      },
      transformPastedHTML(html) {
        // Pasted web markup would otherwise smuggle inline styles and base64
        // images into the note HTML (which is persisted as-is).
        return html
          .replace(/<img[^>]+src=["']data:[^"']*["'][^>]*>/gi, '')
          .replace(/\sstyle=["'][^"']*["']/gi, '')
          .replace(/\sclass=["'][^"']*["']/gi, '');
      },
      handlePaste(_view, event) {
        const items = event.clipboardData?.items;
        if (!items) return false;
        for (const item of items) {
          if (item.type.startsWith('image/')) {
            event.preventDefault();
            window.dispatchEvent(
              new CustomEvent('notebook-toast', {
                detail: 'Images go on the canvas — a note can only hold text',
              })
            );
            return true;
          }
        }
        return false;
      },
    },
    onUpdate: ({ editor: ed, transaction }) => {
      if (!transaction.docChanged) return;
      hasTypedRef.current = true;

      // The store still holds the pre-edit HTML here (content is committed on a
      // debounce), so this is the correct point to snapshot one undo step.
      if (!snapshotTakenRef.current) {
        snapshotTakenRef.current = true;
        useNotesStore.getState().commitUndoSnapshot();
      }

      pendingHtmlRef.current = ed.getHTML();
      if (flushTimerRef.current !== null) return;
      flushTimerRef.current = window.setTimeout(() => {
        flushTimerRef.current = null;
        flushPending();
      }, CONTENT_COMMIT_DELAY);
    },
  });

  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  // Entering/leaving edit mode: snapshot undo once, place the caret, flush.
  useEffect(() => {
    if (!editor) return;
    editor.setEditable(isEditing);

    if (isEditing && !wasEditingRef.current) {
      wasEditingRef.current = true;
      snapshotTakenRef.current = false;

      const caret = pendingCaretRef.current;
      pendingCaretRef.current = null;

      requestAnimationFrame(() => {
        if (editor.isDestroyed) return;
        if (caret) {
          const pos = editor.view.posAtCoords({ left: caret.x, top: caret.y })?.pos;
          editor.commands.focus(pos ?? 'end', { scrollIntoView: false });
        } else {
          editor.commands.focus('end', { scrollIntoView: false });
        }
      });
    } else if (!isEditing && wasEditingRef.current) {
      wasEditingRef.current = false;
      flushPending();
    }
  }, [editor, isEditing, flushPending]);

  // Keep the editor in sync with external changes (undo/redo, imports, style).
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    if (editor.isFocused || pendingHtmlRef.current !== null) return;
    if (editor.getHTML() === element.content) return;

    lastCommittedHtmlRef.current = element.content;
    editor.commands.setContent(element.content, { emitUpdate: false });
  }, [editor, element.content]);

  // Flush anything still buffered when the card unmounts (e.g. culled).
  useEffect(() => () => flushPending(), [flushPending]);

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

  // Inline colour for the current selection while typing. The whole-note colour
  // is applied by the floating toolbar through element.color.
  useEffect(() => {
    const onSetColor = (e: Event) => {
      if (!editor || !isEditing) return;
      const customEv = e as CustomEvent<{ id?: string; color?: string }>;
      if (customEv.detail?.id && customEv.detail.id !== element.id) return;

      const col = customEv.detail?.color;
      if (col) {
        editor.chain().focus().setColor(col).run();
      } else {
        editor.chain().focus().unsetColor().run();
      }
    };

    window.addEventListener('notebook-text-color', onSetColor);
    return () => window.removeEventListener('notebook-text-color', onSetColor);
  }, [editor, element.id, isEditing]);

  const handleBlur = useCallback(
    (e: React.FocusEvent<HTMLDivElement>) => {
      const related = e.relatedTarget as HTMLElement | null;
      if (related && cardRef.current?.contains(related)) return;

      // Persist immediately so a Cmd+Z right after clicking away sees the text.
      flushPending();

      window.setTimeout(() => {
        // Another note took over editing (or this one was explicitly exited).
        const currentEditing = useUiStore.getState().editingId;
        if (currentEditing !== null && currentEditing !== element.id) return;
        if (isDraggingRef.current || isResizingRef.current) {
          useUiStore.getState().setEditingId(null);
          return;
        }

        const active = document.activeElement as HTMLElement | null;
        if (active && cardRef.current?.contains(active)) return;

        const movedToControl = Boolean(
          active?.closest(
            'button, select, input, textarea, [contenteditable="true"], [role="menu"], [data-quick-actions], [data-ai-panel], [data-note-format-bar]'
          )
        );

        useUiStore.getState().setEditingId(null);
        if (movedToControl) return;

        // An untouched empty note just disappears, like a cancelled draft.
        const ed = editorRef.current;
        if (ed && ed.isEmpty && !hasTypedRef.current) {
          useNotesStore.getState().deleteElement(element.id);
          if (useUiStore.getState().selectedId === element.id) {
            useUiStore.getState().setSelectedId(null);
          }
        }
      }, 0);
    },
    [element.id, flushPending]
  );

  // Smooth drag handling (supports dragging single or multiple selected elements)
  const handlePointerDown = (e: React.PointerEvent) => {
    if (activeTool !== 'select') return;
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
    if (activeTool !== 'select') return;
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

  /** Starts editing and remembers where the pointer landed so the caret follows it. */
  const beginEditingAt = (clientX: number, clientY: number) => {
    pendingCaretRef.current = { x: clientX, y: clientY };
    setSelectedId(element.id);
    setEditingId(element.id);
  };

  const handleCardPointerDown = (e: React.PointerEvent) => {
    if (activeTool !== 'select') return;

    // Always keep note clicks away from the canvas: otherwise a marquee starts
    // underneath and drag-selecting text inside a note becomes impossible.
    e.stopPropagation();
    if (e.button !== 0) return;

    const ui = useUiStore.getState();
    if (ui.editingId === element.id) return;

    const isPartOfMultiSelect = ui.selectedIds.includes(element.id) && ui.selectedIds.length > 1;
    if (isPartOfMultiSelect) {
      // Collapse a multi-selection to this note; the next click starts editing.
      setSelectedId(element.id);
      return;
    }

    if (ui.selectedId !== element.id) {
      setSelectedId(element.id);
      return;
    }

    // Already selected → click again to type right where you clicked.
    beginEditingAt(e.clientX, e.clientY);
  };

  const handleCardDoubleClick = (e: React.MouseEvent) => {
    if (activeTool !== 'select') return;
    e.stopPropagation();
    if (useUiStore.getState().editingId === element.id) return;
    beginEditingAt(e.clientX, e.clientY);
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
      {isEditing && (
        <NoteFormatBar
          editor={editor}
          onDone={exitEditing}
          onAction={() => refreshFormatBar((v) => v + 1)}
        />
      )}

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
