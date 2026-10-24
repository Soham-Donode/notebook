import { FC, useState, useEffect, useMemo, useRef } from 'react';
import { Plus, Notebook, Clock, Trash2, MoreHorizontal, Pencil, Search } from 'lucide-react';
import { useNotesStore } from '../../store/useNotesStore';
import { CreateNotebookDialog } from './CreateNotebookDialog';
import { ConfirmDialog } from '../Common/ConfirmDialog';

function formatRelativeDate(timestamp: number): string {
  const now = Date.now();
  const diffMs = now - timestamp;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffHr / 24);

  if (diffDays === 0) {
    if (diffMin < 1) return 'Just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    return `${diffHr}h ago`;
  }
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 30) return `${diffDays}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

export const StartScreen: FC = () => {
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; name: string } | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [renamingNotebook, setRenamingNotebook] = useState<{ id: string; name: string } | null>(null);
  const [renameInput, setRenameInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  const notebooks = useNotesStore((state) => state.notebooks);
  const createNotebook = useNotesStore((state) => state.createNotebook);
  const deleteNotebook = useNotesStore((state) => state.deleteNotebook);
  const renameNotebook = useNotesStore((state) => state.renameNotebook);
  const setActiveNotebook = useNotesStore((state) => state.setActiveNotebook);

  useEffect(() => {
    const handleCloseMenu = () => setOpenMenuId(null);
    if (openMenuId) window.addEventListener('click', handleCloseMenu);
    return () => window.removeEventListener('click', handleCloseMenu);
  }, [openMenuId]);

  // Cmd+K → focus search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const sortedNotebooks = useMemo(
    () => [...notebooks].sort((a, b) => b.updatedAt - a.updatedAt),
    [notebooks]
  );

  const filteredNotebooks = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return sortedNotebooks;
    return sortedNotebooks.filter((nb) => nb.name.toLowerCase().includes(q));
  }, [sortedNotebooks, searchQuery]);

  return (
    <div
      className="w-full h-full select-none flex flex-col transition-colors relative overflow-y-auto"
      style={{
        backgroundImage: 'url(/bg.png)',
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }}
    >
      {/* Dark overlay for readability */}
      <div className="absolute inset-0 bg-black/60 pointer-events-none" />

      {/* ── Header — transparent sticky, no backdrop so gradient is unified ── */}
      <header className="sticky top-0 z-20">
        {/* Row 1: drag region for macOS traffic lights */}
        <div className="drag-region h-9 w-full" />

        {/* Row 2: logo · search · button — same bounds as cards grid */}
        <div className="max-w-7xl mx-auto w-full px-8 py-4 flex items-center gap-4">

          {/* Left — Wordmark */}
          <div className="flex items-center shrink-0 no-drag">
            <span className="text-[26px] font-black uppercase tracking-[0.08em] text-white leading-none">
              NOTEBOOK
            </span>
          </div>

          {/* Center — Search */}
          <div className="flex-1 flex justify-center no-drag">
            <div className="relative w-full max-w-xl">
              <Search
                size={14}
                className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/40 pointer-events-none"
              />
              <input
                ref={searchRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search notebooks…  ⌘K"
                className="w-full h-11 pl-9 pr-4 rounded-full text-[13px] text-white placeholder-white/35 focus:outline-none transition-all"
                style={{
                  background: 'rgba(255,255,255,0.08)',
                  border: '1px solid rgba(255,255,255,0.12)',
                }}
                onFocus={(e) => {
                  e.currentTarget.style.background = 'rgba(255,255,255,0.13)';
                  e.currentTarget.style.border = '1px solid rgba(255,255,255,0.22)';
                }}
                onBlur={(e) => {
                  e.currentTarget.style.background = 'rgba(255,255,255,0.08)';
                  e.currentTarget.style.border = '1px solid rgba(255,255,255,0.12)';
                }}
              />
            </div>
          </div>

          {/* Right — New Notebook */}
          <button
            type="button"
            onClick={() => setIsCreateOpen(true)}
            className="no-drag shrink-0 flex items-center gap-1.5 h-11 px-5 rounded-full text-[13px] font-medium hover:opacity-90 active:scale-95 transition-all duration-150 cursor-pointer"
            style={{
              background: 'rgba(255,255,255,0.15)',
              border: '1px solid rgba(255,255,255,0.22)',
              color: 'rgba(255,255,255,0.95)',
            }}
          >
            <Plus size={15} strokeWidth={2.5} />
            New Notebook
          </button>
        </div>
      </header>

      {/* ── Content — same max-w-7xl px-8 as header row ── */}
      <div className="relative z-10 max-w-7xl w-full mx-auto px-8 pt-8 pb-16 flex flex-col">
        <div>

        {/* Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {filteredNotebooks.length === 0 ? (
            <div className="col-span-full flex flex-col items-center justify-center py-20 text-center">
              <div
                className="w-12 h-12 rounded-2xl flex items-center justify-center mb-3"
                style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.1)' }}
              >
                <Notebook size={22} className="text-white/40" />
              </div>
              <p className="text-sm font-medium text-white/50">
                {searchQuery.trim() ? 'No notebooks match your search' : 'No notebooks yet'}
              </p>
              <p className="text-xs text-white/30 mt-1">
                {searchQuery.trim() ? 'Try a different search term' : 'Click "New Notebook" to get started'}
              </p>
            </div>
          ) : (
            filteredNotebooks.map((nb) => (
              <div
                key={nb.id}
                role="button"
                tabIndex={0}
                onClick={() => setActiveNotebook(nb.id)}
                className="h-[190px] rounded-2xl p-5 flex flex-col justify-between transition-all duration-200 cursor-pointer group no-drag hover:-translate-y-0.5"
                style={{
                  background: 'rgba(255,255,255,0.07)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  backdropFilter: 'blur(20px)',
                  WebkitBackdropFilter: 'blur(20px)',
                  boxShadow: '0 4px 24px rgba(0,0,0,0.25)',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(255,255,255,0.11)';
                  e.currentTarget.style.border = '1px solid rgba(255,255,255,0.18)';
                  e.currentTarget.style.boxShadow = '0 8px 32px rgba(0,0,0,0.35)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'rgba(255,255,255,0.07)';
                  e.currentTarget.style.border = '1px solid rgba(255,255,255,0.1)';
                  e.currentTarget.style.boxShadow = '0 4px 24px rgba(0,0,0,0.25)';
                }}
              >
                {/* Top row: icon + menu */}
                <div className="flex items-center justify-between">
                  <div
                    className="w-9 h-9 rounded-xl flex items-center justify-center"
                    style={{ background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.1)' }}
                  >
                    <Notebook size={18} className="text-white/70" />
                  </div>

                  <div className="flex items-center gap-1.5">
                    <span
                      className="px-2 py-0.5 rounded-full text-[11px] font-medium text-white/60"
                      style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.08)' }}
                    >
                      {nb.sections.length} {nb.sections.length === 1 ? 'section' : 'sections'}
                    </span>

                    {/* Kebab menu */}
                    <div className="relative">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpenMenuId(openMenuId === nb.id ? null : nb.id);
                        }}
                        title="Notebook options"
                        className="p-1.5 rounded-lg text-white/40 hover:text-white/80 hover:bg-white/10 transition cursor-pointer"
                      >
                        <MoreHorizontal size={15} />
                      </button>

                      {openMenuId === nb.id && (
                        <div
                          onClick={(e) => e.stopPropagation()}
                          className="absolute right-0 top-full mt-1.5 w-44 rounded-xl p-1 z-50 no-drag"
                          style={{
                            background: 'rgba(20,24,40,0.92)',
                            border: '1px solid rgba(255,255,255,0.12)',
                            backdropFilter: 'blur(24px)',
                            WebkitBackdropFilter: 'blur(24px)',
                            boxShadow: '0 16px 40px rgba(0,0,0,0.5)',
                          }}
                        >
                          <button
                            type="button"
                            onClick={() => {
                              setOpenMenuId(null);
                              setRenamingNotebook({ id: nb.id, name: nb.name });
                              setRenameInput(nb.name);
                            }}
                            className="w-full px-2.5 py-2 rounded-lg text-left text-xs text-white/70 hover:text-white hover:bg-white/10 transition flex items-center gap-2 cursor-pointer font-medium"
                          >
                            <Pencil size={13} className="text-white/40" />
                            <span>Rename notebook</span>
                          </button>
                          <div className="border-t border-white/[0.07] my-1" />
                          <button
                            type="button"
                            onClick={() => {
                              setOpenMenuId(null);
                              setConfirmDelete({ id: nb.id, name: nb.name });
                            }}
                            className="w-full px-2.5 py-2 rounded-lg text-left text-xs text-red-400 hover:text-red-300 hover:bg-red-500/15 transition flex items-center gap-2 cursor-pointer font-medium"
                          >
                            <Trash2 size={13} />
                            <span>Delete notebook</span>
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Bottom: name + date */}
                <div>
                  <h3 className="text-[15px] font-semibold text-white/90 truncate group-hover:text-white transition-colors">
                    {nb.name}
                  </h3>
                  <p className="text-[11px] text-white/40 mt-1 flex items-center gap-1.5">
                    <Clock size={11} className="shrink-0" />
                    <span>Updated {formatRelativeDate(nb.updatedAt)}</span>
                  </p>
                </div>
              </div>
            ))
          )}
        </div>
        </div>
      </div>

      {/* Create Dialog */}
      <CreateNotebookDialog
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        onCreate={(name) => createNotebook(name)}
      />

      {/* Rename Notebook Dialog */}
      {renamingNotebook && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center backdrop-blur-sm p-4"
          style={{ background: 'rgba(0,0,0,0.5)' }}
          onClick={() => setRenamingNotebook(null)}
        >
          <div
            className="w-full max-w-[420px] rounded-3xl p-6 flex flex-col no-drag"
            style={{
              background: 'rgba(15,18,32,0.92)',
              border: '1px solid rgba(255,255,255,0.12)',
              backdropFilter: 'blur(32px)',
              WebkitBackdropFilter: 'blur(32px)',
              boxShadow: '0 32px 80px rgba(0,0,0,0.6)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold text-white/90 mb-1">Rename Notebook</h3>
            <p className="text-xs text-white/40 mb-4">Enter a new name for your notebook.</p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const trimmed = renameInput.trim();
                if (trimmed && renamingNotebook) {
                  renameNotebook(renamingNotebook.id, trimmed);
                  setRenamingNotebook(null);
                }
              }}
            >
              <input
                type="text"
                autoFocus
                value={renameInput}
                onChange={(e) => setRenameInput(e.target.value)}
                className="w-full h-10 px-3 rounded-xl text-sm text-white/90 placeholder-white/30 focus:outline-none mb-5 transition-all"
                style={{
                  background: 'rgba(255,255,255,0.08)',
                  border: '1px solid rgba(255,255,255,0.12)',
                }}
                placeholder="Notebook name"
              />
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setRenamingNotebook(null)}
                  className="px-4 py-2 rounded-xl text-xs font-medium text-white/50 hover:text-white/80 hover:bg-white/08 transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!renameInput.trim()}
                  className="px-4 py-2 rounded-xl text-xs font-medium text-white disabled:opacity-30 transition cursor-pointer"
                  style={{ background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.2)' }}
                >
                  Save
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Confirm Delete Dialog */}
      <ConfirmDialog
        isOpen={confirmDelete !== null}
        title="Delete Notebook"
        message={`Are you sure you want to delete "${confirmDelete?.name}"? All sections, canvas notes, and imagery will be permanently removed.`}
        confirmLabel="Delete Notebook"
        isDestructive={true}
        onConfirm={async () => {
          if (confirmDelete) {
            await deleteNotebook(confirmDelete.id);
            setConfirmDelete(null);
            window.dispatchEvent(new CustomEvent('inkwell-toast', { detail: 'Notebook deleted' }));
          }
        }}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
};
