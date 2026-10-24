import { type FC, type MouseEvent } from 'react';
import { Copy, ClipboardPaste, CopyPlus, Trash2, Lock, Unlock } from 'lucide-react';
import { CanvasElement } from '../../types';
import { useNotesStore } from '../../store/useNotesStore';
import {
  copyElements,
  duplicateElements,
  getSelectedElements,
  removeElements,
} from '../../utils/elementActions';
import { pasteFromClipboard } from '../../utils/clipboard';

interface ElementQuickActionsProps {
  element: CanvasElement;
  /** Show a lock / unlock toggle (images and PDF pages). */
  showLock?: boolean;
  className?: string;
}

const buttonClass =
  'w-7 h-7 rounded-lg flex items-center justify-center transition cursor-pointer text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-black/[0.05] dark:hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-gray-500 dark:disabled:hover:text-gray-400';

/**
 * Compact in-place action bar shown above a selected canvas element.
 * Shares the same icon-button styling across text notes, images, PDF pages and arrows.
 */
export const ElementQuickActions: FC<ElementQuickActionsProps> = ({
  element,
  showLock = false,
  className = '',
}) => {
  const updateElement = useNotesStore((state) => state.updateElement);

  const stop = (e: MouseEvent) => {
    e.stopPropagation();
  };

  const handleCopy = (e: MouseEvent) => {
    e.stopPropagation();
    copyElements(getSelectedElements(element));
  };

  const handlePaste = (e: MouseEvent) => {
    e.stopPropagation();
    void pasteFromClipboard({ anchor: element });
  };

  const handleDuplicate = (e: MouseEvent) => {
    e.stopPropagation();
    duplicateElements(getSelectedElements(element));
  };

  const handleDelete = (e: MouseEvent) => {
    e.stopPropagation();
    removeElements(getSelectedElements(element));
  };

  const handleToggleLock = (e: MouseEvent) => {
    e.stopPropagation();
    const isLocked = element.type === 'image' || element.type === 'pdf-page' ? element.isLocked : false;
    updateElement(element.id, { isLocked: !isLocked } as Partial<CanvasElement>, true);
  };

  return (
    <div
      data-quick-actions="true"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={stop}
      onDoubleClick={stop}
      className={`flex items-center gap-0.5 shrink-0 ${className}`}
    >
      <button type="button" onClick={handleCopy} title="Copy" className={buttonClass}>
        <Copy size={13} />
      </button>

      <button
        type="button"
        onClick={handlePaste}
        title="Paste from clipboard"
        className={buttonClass}
      >
        <ClipboardPaste size={13} />
      </button>

      <button type="button" onClick={handleDuplicate} title="Duplicate" className={buttonClass}>
        <CopyPlus size={13} />
      </button>

      {showLock && (element.type === 'image' || element.type === 'pdf-page') && (
        <button
          type="button"
          onClick={handleToggleLock}
          title={element.isLocked ? 'Unlock' : 'Lock'}
          className={
            element.isLocked
              ? 'w-7 h-7 rounded-lg flex items-center justify-center transition cursor-pointer bg-amber-100 text-amber-500 hover:bg-amber-200 ring-1 ring-amber-400/40 shadow-xs'
              : buttonClass
          }
        >
          {element.isLocked ? (
            <Lock size={13} className="text-amber-500 fill-amber-500/20" strokeWidth={2.5} />
          ) : (
            <Unlock size={13} strokeWidth={2} />
          )}
        </button>
      )}

      <button
        type="button"
        onClick={handleDelete}
        title="Delete"
        className="w-7 h-7 rounded-lg flex items-center justify-center text-gray-500 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition cursor-pointer"
      >
        <Trash2 size={13} />
      </button>
    </div>
  );
};
