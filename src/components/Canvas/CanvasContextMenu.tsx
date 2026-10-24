import {
  type FC,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import {
  ClipboardPaste,
  Copy,
  CopyPlus,
  CornerUpRight,
  CornerDownRight,
  Lock,
  Pencil,
  RotateCcw,
  Scissors,
  Trash2,
  Unlock,
  MousePointer2,
} from 'lucide-react';
import { CanvasElement } from '../../types';
import { useNotesStore } from '../../store/useNotesStore';
import { useUiStore } from '../../store/useUiStore';
import {
  bringElementsToFront,
  copyElements,
  duplicateElements,
  getSelectedElements,
  removeElements,
  sendElementsToBack,
} from '../../utils/elementActions';
import { hasClipboardContent, pasteFromClipboard } from '../../utils/clipboard';

interface CanvasContextMenuProps {
  x: number;
  y: number;
  element: CanvasElement | null;
  canvasX: number;
  canvasY: number;
  onClose: () => void;
  onCreateNote: (canvasX: number, canvasY: number) => void;
}

interface MenuItemProps {
  icon: ReactNode;
  label: string;
  shortcut?: string;
  disabled?: boolean;
  danger?: boolean;
  onClick: () => void;
}

const MenuItem: FC<MenuItemProps> = ({
  icon,
  label,
  shortcut,
  disabled = false,
  danger = false,
  onClick,
}) => (
  <button
    type="button"
    disabled={disabled}
    onClick={onClick}
    className={`w-full px-2.5 py-2 rounded-lg flex items-center gap-2.5 text-xs font-medium transition text-left cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent ${
      danger
        ? 'text-red-600 dark:text-red-400 hover:bg-red-500/10 dark:hover:bg-red-500/15'
        : 'text-gray-800 dark:text-gray-200 hover:bg-black/[0.05] dark:hover:bg-white/[0.08]'
    }`}
  >
    <span className={danger ? 'text-red-500 dark:text-red-400' : 'text-gray-500 dark:text-gray-400'}>
      {icon}
    </span>
    <span className="flex-1 truncate">{label}</span>
    {shortcut && (
      <span className="text-[10px] font-mono text-gray-400 dark:text-gray-500">{shortcut}</span>
    )}
  </button>
);

const Separator: FC = () => (
  <div className="border-t border-black/[0.06] dark:border-white/[0.08] my-1 mx-1" />
);

export const CanvasContextMenu: FC<CanvasContextMenuProps> = ({
  x,
  y,
  element,
  canvasX,
  canvasY,
  onClose,
  onCreateNote,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });

  const clipboardElements = useUiStore((state) => state.clipboardElements);
  const appHasClipboard = Boolean(clipboardElements && clipboardElements.length > 0);
  const [systemHasClipboard, setSystemHasClipboard] = useState(true);
  const hasClipboard = appHasClipboard || systemHasClipboard;

  // Ask the OS clipboard whether Paste should be enabled. If we can't read
  // it, keep the item enabled rather than falsely greying it out.
  useEffect(() => {
    let cancelled = false;
    hasClipboardContent().then((hasContent) => {
      if (!cancelled) setSystemHasClipboard(hasContent);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const activeElementCount = useNotesStore((state) => {
    const nb = state.notebooks.find((n) => n.id === state.activeNotebookId);
    const sec = nb?.sections.find((s) => s.id === state.activeSectionId);
    return sec?.elements.length ?? 0;
  });

  const selection = element ? getSelectedElements(element) : [];

  // Keep the menu inside the window.
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const margin = 8;
    setPosition({
      left: Math.max(margin, Math.min(x, window.innerWidth - rect.width - margin)),
      top: Math.max(margin, Math.min(y, window.innerHeight - rect.height - margin)),
    });
  }, [x, y, element]);

  // Dismiss on outside click, Escape, scroll or resize.
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    const onScroll = () => onClose();

    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('wheel', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('wheel', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [onClose]);

  const run = (action: () => void) => () => {
    action();
    onClose();
  };

  const handleCut = () => {
    copyElements(selection);
    removeElements(selection);
  };

  const handleLockToggle = () => {
    if (!element || (element.type !== 'image' && element.type !== 'pdf-page')) return;
    useNotesStore.getState().updateElement(element.id, { isLocked: !element.isLocked }, true);
  };

  const handleSelectAll = () => {
    const state = useNotesStore.getState();
    const nb = state.notebooks.find((n) => n.id === state.activeNotebookId);
    const sec = nb?.sections.find((s) => s.id === state.activeSectionId);
    if (!sec) return;
    useUiStore.getState().setSelectedIds(sec.elements.map((el) => el.id));
  };

  const handleEdit = () => {
    if (!element || element.type !== 'text') return;
    useUiStore.getState().setSelectedId(element.id);
    useUiStore.getState().setEditingId(element.id);
  };

  return (
    <div
      ref={menuRef}
      data-canvas-context-menu="true"
      onContextMenu={(e) => e.preventDefault()}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      style={{ left: position.left, top: position.top }}
      className="fixed z-[10000] w-56 rounded-2xl bg-white/95 dark:bg-[#262626]/98 backdrop-blur-2xl border border-black/[0.08] dark:border-white/[0.12] shadow-[0_16px_40px_rgba(0,0,0,0.18)] dark:shadow-[0_20px_48px_rgba(0,0,0,0.6)] p-1.5 animate-fade-in no-drag"
    >
      {element ? (
        <>
          {element.type === 'text' && (
            <>
              <MenuItem icon={<Pencil size={14} />} label="Edit note" onClick={run(handleEdit)} />
              <Separator />
            </>
          )}

          <MenuItem icon={<Scissors size={14} />} label="Cut" shortcut="⌘X" onClick={run(handleCut)} />
          <MenuItem
            icon={<Copy size={14} />}
            label="Copy"
            shortcut="⌘C"
            onClick={run(() => copyElements(selection))}
          />
          <MenuItem
            icon={<ClipboardPaste size={14} />}
            label="Paste here"
            disabled={!hasClipboard}
            onClick={run(() => void pasteFromClipboard({ anchor: element }))}
          />
          <MenuItem
            icon={<CopyPlus size={14} />}
            label="Duplicate"
            shortcut="⌘D"
            onClick={run(() => duplicateElements(selection))}
          />

          <Separator />

          <MenuItem
            icon={<CornerUpRight size={14} />}
            label="Bring to front"
            onClick={run(() => bringElementsToFront(selection))}
          />
          <MenuItem
            icon={<CornerDownRight size={14} />}
            label="Send to back"
            onClick={run(() => sendElementsToBack(selection))}
          />

          {(element.type === 'image' || element.type === 'pdf-page') && (
            <>
              <Separator />
              <MenuItem
                icon={element.isLocked ? <Lock size={14} /> : <Unlock size={14} />}
                label={element.isLocked ? 'Unlock' : 'Lock'}
                onClick={run(handleLockToggle)}
              />
            </>
          )}

          <Separator />

          <MenuItem
            icon={<Trash2 size={14} />}
            label="Delete"
            shortcut="⌫"
            danger
            onClick={run(() => removeElements(selection))}
          />
        </>
      ) : (
        <>
          <MenuItem
            icon={<ClipboardPaste size={14} />}
            label="Paste"
            disabled={!hasClipboard}
            onClick={run(() => void pasteFromClipboard({ point: { x: canvasX, y: canvasY } }))}
          />
          <MenuItem
            icon={<MousePointer2 size={14} />}
            label="Select all"
            shortcut="⌘A"
            disabled={activeElementCount === 0}
            onClick={run(handleSelectAll)}
          />
          <MenuItem
            icon={<Pencil size={14} />}
            label="New note here"
            onClick={run(() => onCreateNote(canvasX, canvasY))}
          />

          <Separator />

          <MenuItem
            icon={<RotateCcw size={14} />}
            label="Reset view"
            shortcut="⌘0"
            onClick={run(() => useNotesStore.getState().resetViewport())}
          />
        </>
      )}
    </div>
  );
};
