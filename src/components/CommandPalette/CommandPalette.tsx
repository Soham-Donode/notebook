import {
  useState,
  useEffect,
  useRef,
  useMemo,
  type FC,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { Search, Layers, Notebook as NotebookIcon, CornerDownLeft, ArrowRightLeft } from 'lucide-react';
import { useNotesStore } from '../../store/useNotesStore';
import {
  searchAndRankItems,
  type SearchItem,
  type ScoredSearchItem,
} from '../../utils/fuzzySearch';

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  /** 'notebooks' = start screen (show only notebooks). 'sections' = inside a notebook (show sections; typing > switches to notebook switcher). */
  mode?: 'notebooks' | 'sections';
}

export const CommandPalette: FC<CommandPaletteProps> = ({ isOpen, onClose, mode = 'sections' }) => {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);

  const notebooks = useNotesStore((state) => state.notebooks);
  const activeNotebookId = useNotesStore((state) => state.activeNotebookId);
  const setActiveNotebook = useNotesStore((state) => state.setActiveNotebook);
  const navigateToSection = useNotesStore((state) => state.navigateToSection);

  // When in 'sections' mode and query starts with '>', switch to notebook switcher
  const isNotebookSwitcher = mode === 'sections' && query.startsWith('>');
  const effectiveQuery = isNotebookSwitcher ? query.slice(1).trimStart() : query;

  // Build search items based on effective mode
  const allSearchItems = useMemo<SearchItem[]>(() => {
    const items: SearchItem[] = [];

    if (mode === 'notebooks' || isNotebookSwitcher) {
      // Show all notebooks
      for (const nb of notebooks) {
        const isCurrentNb = nb.id === activeNotebookId;
        items.push({
          id: `notebook-${nb.id}`,
          type: 'notebook',
          title: nb.name,
          notebookId: nb.id,
          notebookName: nb.name,
          sectionCount: nb.sections.length,
          isCurrentNotebook: isCurrentNb,
          isCurrentNotebookSection: false,
        });
      }
    } else {
      // Inside a notebook: only sections of the active notebook
      const activeNb = notebooks.find((nb) => nb.id === activeNotebookId);
      if (activeNb) {
        for (const sec of activeNb.sections) {
          items.push({
            id: `section-${activeNb.id}-${sec.id}`,
            type: 'section',
            title: sec.name,
            notebookId: activeNb.id,
            notebookName: activeNb.name,
            sectionId: sec.id,
            isCurrentNotebook: true,
            isCurrentNotebookSection: true,
          });
        }
      }
    }

    return items;
  }, [notebooks, activeNotebookId, mode, isNotebookSwitcher]);

  const results: ScoredSearchItem[] = useMemo(() => {
    return searchAndRankItems(allSearchItems, effectiveQuery);
  }, [allSearchItems, effectiveQuery]);

  // Reset state on open
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 30);
    }
  }, [isOpen]);

  useEffect(() => { setSelectedIndex(0); }, [query]);

  useEffect(() => {
    if (itemRefs.current[selectedIndex]) {
      itemRefs.current[selectedIndex]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [selectedIndex]);

  if (!isOpen) return null;

  const handleSelect = (scoredItem?: ScoredSearchItem) => {
    if (!scoredItem) return;
    const item = scoredItem.item;
    if (item.type === 'section' && item.sectionId) {
      navigateToSection(item.notebookId, item.sectionId);
    } else if (item.type === 'notebook') {
      setActiveNotebook(item.notebookId);
    }
    onClose();
  };

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (results.length === 0) return;
      setSelectedIndex((prev) => (prev + 1) % results.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (results.length === 0) return;
      setSelectedIndex((prev) => (prev - 1 + results.length) % results.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (results[selectedIndex]) handleSelect(results[selectedIndex]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  const renderTitle = (title: string, indices: number[]) => {
    if (!indices || indices.length === 0) return <span>{title}</span>;
    const indexSet = new Set(indices);
    return (
      <span>
        {title.split('').map((char, idx) =>
          indexSet.has(idx) ? (
            <span key={idx} className="font-bold text-white underline decoration-white/30">{char}</span>
          ) : (
            <span key={idx}>{char}</span>
          )
        )}
      </span>
    );
  };

  const getPlaceholder = () => {
    if (isNotebookSwitcher) return 'Switch to notebook…';
    if (mode === 'notebooks') return 'Search notebooks…';
    return 'Search sections…  type > to switch notebooks';
  };

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-start justify-center pt-[15vh] p-4 select-none"
      style={{ background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-[580px] rounded-2xl flex flex-col overflow-hidden no-drag"
        style={{
          background: 'rgba(12,16,28,0.82)',
          border: '1px solid rgba(255,255,255,0.12)',
          backdropFilter: 'blur(32px)',
          WebkitBackdropFilter: 'blur(32px)',
          boxShadow: '0 32px 80px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.04)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search Input */}
        <div
          className="flex items-center px-4 py-3.5 gap-3"
          style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}
        >
          {/* Icon: switch between search and switcher icon */}
          {isNotebookSwitcher ? (
            <ArrowRightLeft size={16} className="text-emerald-400 shrink-0" />
          ) : (
            <Search size={16} className="text-white/35 shrink-0" />
          )}

          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={getPlaceholder()}
            className="flex-1 bg-transparent text-[14px] text-white/90 placeholder-white/25 outline-none font-normal"
          />

          <kbd
            className="shrink-0 px-1.5 py-0.5 text-[10px] font-medium tracking-wide rounded-md text-white/30"
            style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)' }}
          >
            ESC
          </kbd>
        </div>

        {/* Results List */}
        <div ref={listRef} className="flex-1 overflow-y-auto p-2 space-y-0.5 max-h-[400px] min-h-[120px]">
          {results.length === 0 ? (
            <div className="py-14 px-4 text-center">
              <Search size={26} className="mx-auto mb-3 text-white/15" />
              <p className="text-xs font-medium text-white/30">
                {effectiveQuery
                  ? `No ${isNotebookSwitcher || mode === 'notebooks' ? 'notebooks' : 'sections'} matching "${effectiveQuery}"`
                  : `No ${isNotebookSwitcher || mode === 'notebooks' ? 'notebooks' : 'sections'} found`}
              </p>
            </div>
          ) : (
            results.map((scored, index) => {
              const item = scored.item;
              const isSelected = index === selectedIndex;
              const isSection = item.type === 'section';

              return (
                <div
                  key={item.id}
                  ref={(el) => { itemRefs.current[index] = el; }}
                  onMouseEnter={() => setSelectedIndex(index)}
                  onClick={() => handleSelect(scored)}
                  className="w-full px-3 py-2.5 rounded-xl flex items-center justify-between text-xs cursor-pointer select-none transition-all"
                  style={{
                    background: isSelected ? 'rgba(255,255,255,0.1)' : 'transparent',
                    border: isSelected ? '1px solid rgba(255,255,255,0.1)' : '1px solid transparent',
                  }}
                  onMouseLeave={(e) => {
                    if (index !== selectedIndex) {
                      e.currentTarget.style.background = 'transparent';
                    }
                  }}
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1 mr-2">
                    {/* Icon */}
                    <div
                      className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
                      style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.08)' }}
                    >
                      {isSection ? (
                        <Layers size={14} strokeWidth={2} className="text-white/50" />
                      ) : (
                        <NotebookIcon size={14} strokeWidth={2} className="text-white/50" />
                      )}
                    </div>

                    {/* Title & subtitle */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 truncate">
                        <span className="font-medium text-[13px] text-white/85 truncate">
                          {renderTitle(item.title, scored.indices)}
                        </span>
                        {!isSection && item.isCurrentNotebook && (
                          <span
                            className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium text-white/50"
                            style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.08)' }}
                          >
                            Current
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-white/30 truncate mt-0.5">
                        {isSection ? (
                          <span>In &ldquo;{item.notebookName}&rdquo;</span>
                        ) : (
                          <span>{item.sectionCount} {item.sectionCount === 1 ? 'section' : 'sections'}</span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Right side */}
                  <div className="flex items-center gap-2 shrink-0">
                    <span
                      className="text-[10px] uppercase font-semibold tracking-wider text-white/25 px-1.5 py-0.5 rounded"
                      style={{ background: 'rgba(255,255,255,0.05)' }}
                    >
                      {isSection ? 'Section' : 'Notebook'}
                    </span>
                    {isSelected && (
                      <span className="flex items-center gap-1 text-[11px] font-medium text-white/40 pl-1">
                        <span>Open</span>
                        <CornerDownLeft size={11} strokeWidth={2.2} />
                      </span>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer hint */}
        <div
          className="px-4 py-2.5 flex items-center gap-4"
          style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}
        >
          <span className="text-[11px] text-white/20 flex items-center gap-1.5">
            <kbd className="px-1 py-0.5 rounded text-[10px]" style={{ background: 'rgba(255,255,255,0.07)' }}>↑↓</kbd>
            navigate
          </span>
          <span className="text-[11px] text-white/20 flex items-center gap-1.5">
            <kbd className="px-1 py-0.5 rounded text-[10px]" style={{ background: 'rgba(255,255,255,0.07)' }}>↵</kbd>
            open
          </span>
          {mode === 'sections' && !isNotebookSwitcher && (
            <span className="text-[11px] text-white/20 flex items-center gap-1.5">
              <kbd className="px-1 py-0.5 rounded text-[10px]" style={{ background: 'rgba(255,255,255,0.07)' }}>&gt;</kbd>
              switch notebook
            </span>
          )}
        </div>
      </div>
    </div>
  );
};
