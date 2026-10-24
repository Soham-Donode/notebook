import {
  type FC,
  useState,
  useRef,
  useEffect,
} from 'react';
import {
  PanelLeft,
  ChevronDown,
  Plus,
  Trash2,
  Notebook,
  Layers,
  Check,
  ArrowLeft,
  MoreHorizontal,
  Pencil,
  Search,
} from 'lucide-react';
import { useNotesStore } from '../../store/useNotesStore';
import { useUiStore } from '../../store/useUiStore';
import { Section } from '../../types';
import { ConfirmDialog } from '../Common/ConfirmDialog';

interface SidebarProps {
  onNewNotebookClick?: () => void;
  onGoToStartScreen?: () => void;
}

export const Sidebar: FC<SidebarProps> = ({ onNewNotebookClick, onGoToStartScreen }) => {
  const isSidebarOpen = useUiStore((state) => state.isSidebarOpen);
  const toggleSidebar = useUiStore((state) => state.toggleSidebar);

  const notebooks = useNotesStore((state) => state.notebooks);
  const activeNotebookId = useNotesStore((state) => state.activeNotebookId);
  const activeSectionId = useNotesStore((state) => state.activeSectionId);

  const setActiveNotebook = useNotesStore((state) => state.setActiveNotebook);
  const deleteNotebook = useNotesStore((state) => state.deleteNotebook);
  const renameNotebook = useNotesStore((state) => state.renameNotebook);
  const addSection = useNotesStore((state) => state.addSection);
  const renameSection = useNotesStore((state) => state.renameSection);
  const moveSection = useNotesStore((state) => state.moveSection);
  const deleteSection = useNotesStore((state) => state.deleteSection);
  const setActiveSection = useNotesStore((state) => state.setActiveSection);

  const activeNotebook = notebooks.find((nb) => nb.id === activeNotebookId);

  // Notebook switcher dropdown state
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Rename & context menu inside dropdown
  const [menuNotebookId, setMenuNotebookId] = useState<string | null>(null);
  const [renamingNotebookId, setRenamingNotebookId] = useState<string | null>(null);
  const [renameNotebookInput, setRenameNotebookInput] = useState('');

  // Inline section renaming state
  const [editingSectionId, setEditingSectionId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);

  // Confirmation dialog state for deleting sections or notebooks
  const [confirmDelete, setConfirmDelete] = useState<{
    type: 'section' | 'notebook';
    id: string;
    name: string;
  } | null>(null);

  // Section drag-to-reorder state
  const [sectionDrag, setSectionDrag] = useState<{
    sectionId: string;
    pointerY: number;
    grabOffsetY: number;
    ghostLeft: number;
    ghostWidth: number;
    ghostHeight: number;
    targetIndex: number;
  } | null>(null);
  const sectionDragSessionRef = useRef<{
    sectionId: string;
    startX: number;
    startY: number;
    grabOffsetY: number;
    ghostLeft: number;
    ghostWidth: number;
    ghostHeight: number;
    startScrollTop: number;
    sectionRects: Map<string, DOMRect>;
    started: boolean;
    pointerY: number;
    targetIndex: number;
  } | null>(null);
  const suppressSectionClickRef = useRef(false);
  const sectionListRef = useRef<HTMLDivElement>(null);

  /** Insertion index among the other sections for the current pointer position. */
  const getSectionTargetIndex = (
    pointerY: number,
    rects: Map<string, DOMRect>,
    draggedId: string,
    sections: Section[]
  ) => {
    let index = 0;
    for (const sec of sections) {
      if (sec.id === draggedId) continue;
      const rect = rects.get(sec.id);
      if (!rect) continue;
      if (pointerY > rect.top + rect.height / 2) index += 1;
    }
    return index;
  };

  const handleSectionPointerDown = (
    e: React.PointerEvent<HTMLDivElement>,
    section: Section
  ) => {
    if (e.button !== 0 || editingSectionId === section.id) return;

    const targetEl = e.target as HTMLElement;
    if (targetEl.closest('button, input, textarea')) return;

    const listEl = sectionListRef.current;
    if (!listEl) return;

    const sectionRects = new Map<string, DOMRect>();
    listEl.querySelectorAll<HTMLElement>('[data-section-id]').forEach((el) => {
      const id = el.dataset.sectionId;
      if (id) sectionRects.set(id, el.getBoundingClientRect());
    });

    const rowRect = e.currentTarget.getBoundingClientRect();
    const listRect = listEl.getBoundingClientRect();

    sectionDragSessionRef.current = {
      sectionId: section.id,
      startX: e.clientX,
      startY: e.clientY,
      grabOffsetY: e.clientY - rowRect.top,
      ghostLeft: rowRect.left,
      ghostWidth: rowRect.width,
      ghostHeight: rowRect.height,
      startScrollTop: listEl.scrollTop,
      sectionRects,
      started: false,
      pointerY: e.clientY,
      targetIndex: 0,
    };

    const onMove = (ev: PointerEvent) => {
      const current = sectionDragSessionRef.current;
      if (!current) return;

      if (!current.started) {
        if (Math.hypot(ev.clientX - current.startX, ev.clientY - current.startY) < 4) {
          return;
        }
        current.started = true;
        suppressSectionClickRef.current = true;
      }

      ev.preventDefault();
      current.pointerY = ev.clientY;

      // Auto-scroll while the pointer rests near the top or bottom edge.
      const edge = 36;
      if (ev.clientY < listRect.top + edge) {
        listEl.scrollTop = Math.max(0, listEl.scrollTop - 12);
      } else if (ev.clientY > listRect.bottom - edge) {
        listEl.scrollTop = Math.min(listEl.scrollHeight, listEl.scrollTop + 12);
      }

      // Frozen rects + scroll delta keeps the target stable while the list moves.
      const scrollDelta = listEl.scrollTop - current.startScrollTop;
      const contentY = ev.clientY + scrollDelta;
      const notebook = useNotesStore
        .getState()
        .notebooks.find((nb) => nb.id === useNotesStore.getState().activeNotebookId);
      const targetIndex = getSectionTargetIndex(
        contentY,
        current.sectionRects,
        current.sectionId,
        notebook?.sections ?? []
      );
      current.targetIndex = targetIndex;

      setSectionDrag({
        sectionId: current.sectionId,
        pointerY: ev.clientY,
        grabOffsetY: current.grabOffsetY,
        ghostLeft: current.ghostLeft,
        ghostWidth: current.ghostWidth,
        ghostHeight: current.ghostHeight,
        targetIndex,
      });
    };

    const finish = () => {
      const current = sectionDragSessionRef.current;
      sectionDragSessionRef.current = null;

      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);

      if (current?.started) {
        const notebookId = useNotesStore.getState().activeNotebookId;
        if (notebookId) {
          moveSection(notebookId, current.sectionId, current.targetIndex);
        }
      }

      setSectionDrag(null);
      // Clear after the click that follows pointerup has been swallowed.
      window.setTimeout(() => {
        suppressSectionClickRef.current = false;
      }, 0);
    };

    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
  };

  const notebookSections = activeNotebook?.sections ?? [];
  const draggedSection = sectionDrag
    ? notebookSections.find((sec) => sec.id === sectionDrag.sectionId) ?? null
    : null;
  const displaySections = (() => {
    if (!sectionDrag) return notebookSections;
    const dragged = notebookSections.find((sec) => sec.id === sectionDrag.sectionId);
    if (!dragged) return notebookSections;
    const rest = notebookSections.filter((sec) => sec.id !== sectionDrag.sectionId);
    const target = Math.max(0, Math.min(sectionDrag.targetIndex, rest.length));
    rest.splice(target, 0, dragged);
    return rest;
  })();

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsDropdownOpen(false);
        setMenuNotebookId(null);
        setRenamingNotebookId(null);
      }
    };
    if (isDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isDropdownOpen]);

  useEffect(() => {
    if (editingSectionId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [editingSectionId]);

  const handleStartRename = (secId: string, currentName: string) => {
    setEditingSectionId(secId);
    setEditingName(currentName);
  };

  const handleFinishRename = (secId: string) => {
    const trimmed = editingName.trim();
    if (!activeNotebookId) return;
    renameSection(activeNotebookId, secId, trimmed || 'Untitled Section');
    setEditingSectionId(null);
  };

  const handleAddSection = () => {
    if (!activeNotebookId) return;
    addSection(activeNotebookId);
  };

  const handleConfirmDelete = async () => {
    if (!confirmDelete) return;

    if (confirmDelete.type === 'section') {
      if (activeNotebookId) {
        await deleteSection(activeNotebookId, confirmDelete.id);
      }
    } else if (confirmDelete.type === 'notebook') {
      await deleteNotebook(confirmDelete.id);
      window.dispatchEvent(new CustomEvent('inkwell-toast', { detail: 'Notebook deleted' }));
      if (notebooks.length <= 1) {
        onGoToStartScreen?.();
      }
    }
    setConfirmDelete(null);
  };

  return (
    <>
      {/* Floating PanelLeft toggle button when sidebar is collapsed (placed below traffic lights at top-10) */}
      {!isSidebarOpen && (
        <button
          type="button"
          onClick={toggleSidebar}
          title="Open Sidebar"
          className="absolute top-10 left-3.5 z-50 h-11 w-11 rounded-2xl bg-white/90 hover:bg-white dark:bg-[#262626]/95 dark:hover:bg-[#2f2f2f] backdrop-blur-2xl border border-black/[0.08] dark:border-white/10 shadow-[0_8px_30px_rgba(0,0,0,0.08)] dark:shadow-[0_8px_30px_rgba(0,0,0,0.35)] text-gray-700 dark:text-gray-200 flex items-center justify-center cursor-pointer transition-all duration-150 no-drag hover:scale-105 active:scale-95 shrink-0"
        >
          <PanelLeft size={16} />
        </button>
      )}

      {/* Sidebar container with macOS vibrant aesthetic */}
      <aside
        className={`h-full bg-[#F5F5F7]/85 dark:bg-[#171717] backdrop-blur-xl border-r border-black/[0.06] dark:border-white/[0.08] flex flex-col shrink-0 overflow-hidden transition-all duration-200 select-none z-30 relative ${
          isSidebarOpen ? 'w-[280px] px-3.5' : 'w-0 px-0 pt-0 border-r-0'
        }`}
      >
        {/* Dedicated top padding (pt-10 = 40px) to clear macOS traffic light buttons */}
        <div className="w-full flex flex-col h-full pt-10">
          {/* Top row: back to all notebooks · wordmark · sidebar toggle */}
          <div className="h-11 grid grid-cols-[2.75rem_1fr_2.75rem] items-center mb-2">
            <button
              type="button"
              onClick={() => onGoToStartScreen?.()}
              title="Back to all notebooks"
              className="w-11 h-11 rounded-xl text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-black/[0.05] dark:hover:bg-white/[0.08] active:scale-95 flex items-center justify-center transition cursor-pointer shrink-0 justify-self-start"
            >
              <ArrowLeft size={17} />
            </button>
            <span className="text-[13px] font-black uppercase tracking-[0.14em] text-gray-900 dark:text-gray-100 text-center leading-none">
              Notebook
            </span>
            <button
              type="button"
              onClick={toggleSidebar}
              title="Close Sidebar"
              className="w-11 h-11 rounded-xl text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-black/[0.05] dark:hover:bg-white/[0.08] active:scale-95 flex items-center justify-center transition cursor-pointer shrink-0 justify-self-end"
            >
              <PanelLeft size={17} />
            </button>
          </div>

          {/* Notebook selector — full width */}
          <div className="mb-3 pb-3 border-b border-black/[0.06] dark:border-white/[0.08]">
            <div ref={dropdownRef} className="relative w-full">
              <button
                type="button"
                onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                className="w-full h-11 px-3 rounded-xl bg-gray-100/90 hover:bg-gray-200/80 dark:bg-[#333333] dark:hover:bg-[#3e3e3e] active:scale-95 text-gray-800 dark:text-gray-200 text-xs font-medium flex items-center gap-2 transition cursor-pointer border border-black/[0.04] dark:border-white/[0.06]"
              >
                <Notebook size={15} strokeWidth={2} className="text-gray-700 dark:text-gray-200 shrink-0" />
                <div className="flex items-center min-w-0 text-left flex-1">
                  <span className="font-medium text-gray-900 dark:text-gray-100 text-xs truncate">
                    {activeNotebook?.name ?? 'Notebook'}
                  </span>
                </div>
                <ChevronDown size={12} className="shrink-0 text-gray-400 dark:text-gray-400 ml-0.5" />
              </button>

              {/* Apple-style Popover Menu for Notebook Switching & Management */}
              {isDropdownOpen && (
                <div className="absolute top-full left-0 mt-2 w-full rounded-xl bg-white/95 dark:bg-[#262626]/98 backdrop-blur-2xl shadow-[0_16px_40px_rgba(0,0,0,0.14)] dark:shadow-[0_16px_40px_rgba(0,0,0,0.5)] border border-black/10 dark:border-white/10 p-1.5 z-50 animate-fade-in no-drag">
                  <div className="px-2 py-1 text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">
                    Notebooks
                  </div>
                  <div className="max-h-56 overflow-y-auto my-0.5 space-y-0.5">
                    {notebooks.map((nb) => {
                      const isActive = nb.id === activeNotebookId;
                      return (
                        <div
                          key={nb.id}
                          onClick={() => {
                            if (renamingNotebookId !== nb.id) {
                              setActiveNotebook(nb.id);
                              setIsDropdownOpen(false);
                            }
                          }}
                          className={`w-full h-11 px-2.5 rounded-lg text-left flex items-center justify-between group transition-colors cursor-pointer ${
                            isActive
                              ? 'bg-black/[0.05] dark:bg-white/[0.1] text-black dark:text-white font-semibold'
                              : 'text-gray-700 dark:text-gray-300 hover:bg-black/[0.03] dark:hover:bg-white/[0.05]'
                          }`}
                        >
                          <div className="flex items-center gap-2 min-w-0 flex-1 mr-1.5">
                            <Notebook
                              size={14}
                              strokeWidth={2}
                              className={isActive ? 'text-black dark:text-white shrink-0' : 'text-gray-400 dark:text-gray-500 shrink-0'}
                            />
                            {renamingNotebookId === nb.id ? (
                              <input
                                type="text"
                                autoFocus
                                value={renameNotebookInput}
                                onChange={(e) => setRenameNotebookInput(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    const trimmed = renameNotebookInput.trim();
                                    if (trimmed) renameNotebook(nb.id, trimmed);
                                    setRenamingNotebookId(null);
                                  } else if (e.key === 'Escape') {
                                    setRenamingNotebookId(null);
                                  }
                                }}
                                onBlur={() => {
                                  const trimmed = renameNotebookInput.trim();
                                  if (trimmed) renameNotebook(nb.id, trimmed);
                                  setRenamingNotebookId(null);
                                }}
                                onClick={(e) => e.stopPropagation()}
                                className="w-full text-xs font-medium px-1.5 py-0.5 rounded bg-white dark:bg-[#1a1a1a] border border-blue-500 text-gray-900 dark:text-gray-100 focus:outline-none"
                              />
                            ) : (
                              <div className="flex flex-col min-w-0">
                                <span className="text-xs truncate font-medium text-gray-900 dark:text-gray-100 leading-tight">
                                  {nb.name}
                                </span>
                                <span className="text-[10px] text-gray-400 dark:text-gray-500 truncate">
                                  {nb.sections.length} {nb.sections.length === 1 ? 'section' : 'sections'}
                                </span>
                              </div>
                            )}
                          </div>

                          <div className="flex items-center gap-1 shrink-0 relative">
                            {/* 3 horizontal dots menu - always visible */}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setMenuNotebookId(menuNotebookId === nb.id ? null : nb.id);
                              }}
                              title="Notebook options"
                              className="p-1 rounded-md text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-black/[0.06] dark:hover:bg-white/[0.1] transition cursor-pointer"
                            >
                              <MoreHorizontal size={13} />
                            </button>

                            {menuNotebookId === nb.id && (
                              <div
                                onClick={(e) => e.stopPropagation()}
                                className="absolute right-0 top-full mt-1 w-36 rounded-xl bg-white/95 dark:bg-[#2A2A2A]/98 backdrop-blur-2xl shadow-xl border border-black/10 dark:border-white/10 p-1 z-50 animate-fade-in no-drag"
                              >
                                <button
                                  type="button"
                                  onClick={() => {
                                    setMenuNotebookId(null);
                                    setRenamingNotebookId(nb.id);
                                    setRenameNotebookInput(nb.name);
                                  }}
                                  className="w-full px-2 py-1.5 rounded-lg text-left text-xs text-gray-800 dark:text-gray-200 hover:bg-black/[0.04] dark:hover:bg-white/[0.08] transition flex items-center gap-2 cursor-pointer font-medium"
                                >
                                  <Pencil size={12} className="text-gray-500 dark:text-gray-400" />
                                  <span>Rename</span>
                                </button>
                                {notebooks.length > 1 && (
                                  <>
                                    <div className="border-t border-black/[0.06] dark:border-white/[0.08] my-0.5" />
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setMenuNotebookId(null);
                                        setConfirmDelete({
                                          type: 'notebook',
                                          id: nb.id,
                                          name: nb.name,
                                        });
                                      }}
                                      className="w-full px-2 py-1.5 rounded-lg text-left text-xs text-red-600 dark:text-red-400 hover:bg-red-500/10 dark:hover:bg-red-500/20 transition flex items-center gap-2 cursor-pointer font-medium"
                                    >
                                      <Trash2 size={12} />
                                      <span>Delete</span>
                                    </button>
                                  </>
                                )}
                              </div>
                            )}

                            {/* Active checkmark */}
                            {isActive && (
                              <Check size={13} strokeWidth={2.5} className="text-black dark:text-white shrink-0" />
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="border-t border-black/[0.06] dark:border-white/[0.08] pt-1 mt-1 space-y-0.5">
                    <button
                      type="button"
                      onClick={() => {
                        setIsDropdownOpen(false);
                        onNewNotebookClick?.();
                      }}
                      className="w-full h-11 px-2.5 rounded-lg text-left text-xs text-gray-700 dark:text-gray-300 hover:bg-black/[0.04] dark:hover:bg-white/[0.06] flex items-center gap-2 cursor-pointer font-medium transition-colors"
                    >
                      <Plus size={14} className="text-gray-500 dark:text-gray-400 shrink-0" />
                      <span>New Notebook</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Quick Switcher / Search bar trigger button */}
          <button
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent('inkwell-open-command-palette'))}
            title="Search sections and notebooks (⌘K)"
            className="w-full h-9 mb-3 px-3 rounded-xl bg-gray-100/90 hover:bg-gray-200/80 dark:bg-[#252525] dark:hover:bg-[#2e2e2e] border border-black/[0.04] dark:border-white/[0.06] text-xs text-gray-500 dark:text-gray-400 flex items-center justify-between transition-colors cursor-pointer group"
          >
            <span className="flex items-center gap-2">
              <Search size={13} className="text-gray-400 group-hover:text-gray-600 dark:group-hover:text-gray-300 transition-colors" />
              <span className="font-normal">Search…</span>
            </span>
            <kbd className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-black/[0.05] dark:bg-white/10 text-gray-400 dark:text-gray-400 border border-black/[0.04] dark:border-white/[0.06]">
              ⌘K
            </kbd>
          </button>

          {/* Section list label */}
          <div className="flex items-center justify-between px-1 mb-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
              Sections
            </span>
            <span className="text-[11px] text-gray-400 dark:text-gray-500">
              {activeNotebook?.sections.length ?? 0}
            </span>
          </div>

          {/* Section pills */}
          <div ref={sectionListRef} className="flex-1 overflow-y-auto space-y-1.5 pr-0.5 pb-4">
            {displaySections.map((sec) => {
              const isActive = sec.id === activeSectionId;
              const isRenaming = editingSectionId === sec.id;
              const isDragging = sectionDrag?.sectionId === sec.id;

              if (isDragging) {
                return (
                  <div
                    key={sec.id}
                    data-section-id={sec.id}
                    className="w-full h-11 rounded-xl border border-dashed border-black/15 dark:border-white/20 bg-black/[0.02] dark:bg-white/[0.03]"
                  />
                );
              }

              return (
                <div
                  key={sec.id}
                  data-section-id={sec.id}
                  onPointerDown={(e) => handleSectionPointerDown(e, sec)}
                  onClick={() => {
                    if (suppressSectionClickRef.current) {
                      suppressSectionClickRef.current = false;
                      return;
                    }
                    setActiveSection(sec.id);
                  }}
                  onDoubleClick={() => handleStartRename(sec.id, sec.name)}
                  className={`w-full h-11 rounded-xl px-3 flex items-center justify-between text-xs font-medium transition-colors cursor-grab active:cursor-grabbing select-none group relative ${
                    isActive
                      ? 'bg-white dark:bg-[#2F2F2F] text-gray-900 dark:text-gray-100 font-medium shadow-[0_2px_8px_rgba(0,0,0,0.06)] dark:shadow-[0_2px_8px_rgba(0,0,0,0.3)] border border-black/[0.04] dark:border-white/[0.08]'
                      : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-black/[0.04] dark:hover:bg-white/[0.05]'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0 flex-1 mr-1.5">
                    <Layers
                      size={14}
                      className={isActive ? 'text-black dark:text-white shrink-0' : 'text-gray-400 dark:text-gray-500 shrink-0'}
                    />
                    {isRenaming ? (
                      <input
                        ref={renameInputRef}
                        type="text"
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        onBlur={() => handleFinishRename(sec.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleFinishRename(sec.id);
                          if (e.key === 'Escape') setEditingSectionId(null);
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className="w-full h-5 bg-transparent text-gray-900 dark:text-gray-100 text-xs font-medium border-b border-black dark:border-white focus:outline-none"
                      />
                    ) : (
                      <span className="truncate text-xs font-medium">{sec.name}</span>
                    )}
                  </div>

                  {/* Delete button (if more than 1 section) */}
                  {!isRenaming && notebookSections.length > 1 && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setConfirmDelete({
                          type: 'section',
                          id: sec.id,
                          name: sec.name,
                        });
                      }}
                      title="Delete Section"
                      className="opacity-0 group-hover:opacity-100 p-1 rounded-md hover:bg-black/10 dark:hover:bg-white/10 text-gray-400 hover:text-red-600 dark:hover:text-red-400 transition cursor-pointer shrink-0"
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              );
            })}

            {/* + Add Section Button */}
            <button
              type="button"
              onClick={handleAddSection}
              className="w-full h-11 mt-2 rounded-xl border border-dashed border-gray-300/80 dark:border-white/15 hover:border-gray-400 dark:hover:border-white/30 text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 text-xs font-medium flex items-center justify-center gap-2 transition cursor-pointer select-none hover:bg-white/50 dark:hover:bg-white/[0.04]"
            >
              <Plus size={14} />
              <span>Add Section</span>
            </button>
          </div>
        </div>
      </aside>

      {/* Dragged section ghost that follows the pointer */}
      {sectionDrag && draggedSection && (
        <div
          className="fixed z-[9999] pointer-events-none rounded-xl px-3 flex items-center gap-2.5 text-xs font-medium bg-white dark:bg-[#2F2F2F] text-gray-900 dark:text-gray-100 shadow-[0_10px_28px_rgba(0,0,0,0.18)] dark:shadow-[0_10px_28px_rgba(0,0,0,0.5)] border border-black/[0.06] dark:border-white/[0.1] scale-[1.02]"
          style={{
            left: sectionDrag.ghostLeft,
            top: sectionDrag.pointerY - sectionDrag.grabOffsetY,
            width: sectionDrag.ghostWidth,
            height: sectionDrag.ghostHeight,
          }}
        >
          <Layers size={14} className="text-gray-400 dark:text-gray-500 shrink-0" />
          <span className="truncate text-xs font-medium">{draggedSection.name}</span>
        </div>
      )}

      {/* Confirmation Dialog for Deleting Section or Notebook */}
      <ConfirmDialog
        isOpen={confirmDelete !== null}
        title={confirmDelete?.type === 'section' ? 'Delete Section' : 'Delete Notebook'}
        message={
          confirmDelete?.type === 'section'
            ? `Are you sure you want to delete "${confirmDelete?.name}"? All notes, images, and pages in this section will be permanently deleted.`
            : `Are you sure you want to delete "${confirmDelete?.name}"? All sections, canvas notes, and imagery will be permanently removed.`
        }
        confirmLabel={confirmDelete?.type === 'section' ? 'Delete Section' : 'Delete Notebook'}
        isDestructive={true}
        onConfirm={handleConfirmDelete}
        onCancel={() => setConfirmDelete(null)}
      />
    </>
  );
};
