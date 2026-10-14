import { modKey } from '../../utils/platform';
import {
  type FC,
  useState,
  useRef,
  useEffect,
  type ChangeEvent,
} from 'react';
import {
  FileUp,
  ChevronDown,
  MoreVertical,
  Type,
  Download,
  RotateCcw,
  Trash2,
  Paperclip,
  Hand,
  MousePointer2,
  CornerUpRight,
  Sun,
  Moon,
  Bold,
  Palette,
  Presentation,
} from 'lucide-react';
import { useNotesStore } from '../../store/useNotesStore';
import { useUiStore } from '../../store/useUiStore';
import { useThemeStore } from '../../store/useThemeStore';
import { TextElement } from '../../types';

interface FloatingToolbarProps {
  onAddPdfClick: () => void;
  onAddImageClick: () => void;
  onAddPptClick: () => void;
  onExportPdfClick?: () => void;
}

const FONT_FAMILIES = [
  { label: 'Comic Sans MS', value: 'Comic Sans MS, Comic Neue, cursive, sans-serif' },
  { label: 'Inter', value: 'Inter, sans-serif' },
  { label: 'Times New Roman', value: 'Times New Roman, serif' },
  { label: 'System', value: 'var(--font-ui)' },
  { label: 'Fira Code', value: 'Fira Code, monospace' },
];

const FONT_SIZES = [14, 16, 18, 24, 32, 48];

const TEXT_COLORS = [
  { label: 'Default', value: '' }, // Auto (black in light, #ECECEC in dark)
  { label: 'Red', value: '#EF4444' },
  { label: 'Orange', value: '#F97316' },
  { label: 'Amber', value: '#F59E0B' },
  { label: 'Green', value: '#10B981' },
  { label: 'Blue', value: '#3B82F6' },
  { label: 'Purple', value: '#8B5CF6' },
  { label: 'Pink', value: '#EC4899' },
  { label: 'Gray', value: '#6B7280' },
];

export const FloatingToolbar: FC<FloatingToolbarProps> = ({
  onAddPdfClick,
  onAddImageClick,
  onAddPptClick,
  onExportPdfClick,
}) => {
  const selectedId = useUiStore((state) => state.selectedId);
  const activeTool = useUiStore((state) => state.activeTool);
  const setActiveTool = useUiStore((state) => state.setActiveTool);

  const theme = useThemeStore((state) => state.theme);
  const toggleTheme = useThemeStore((state) => state.toggleTheme);

  const activeSection = useNotesStore((state) => {
    const nb = state.notebooks.find((n) => n.id === state.activeNotebookId);
    return nb?.sections.find((s) => s.id === state.activeSectionId);
  });

  const updateElement = useNotesStore((state) => state.updateElement);
  const resetViewport = useNotesStore((state) => state.resetViewport);
  const clearCanvas = useNotesStore((state) => state.clearCanvas);

  const selectedTextElement = activeSection?.elements.find(
    (el) => el.id === selectedId && el.type === 'text'
  ) as TextElement | undefined;

  const defaultFontFamily = useUiStore((state) => state.defaultFontFamily);
  const setDefaultFontFamily = useUiStore((state) => state.setDefaultFontFamily);
  const defaultFontSize = useUiStore((state) => state.defaultFontSize);
  const setDefaultFontSize = useUiStore((state) => state.setDefaultFontSize);
  const defaultColor = useUiStore((state) => state.defaultColor);
  const setDefaultColor = useUiStore((state) => state.setDefaultColor);

  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const [isColorMenuOpen, setIsColorMenuOpen] = useState(false);
  const colorMenuRef = useRef<HTMLDivElement>(null);

  const [isAddMenuOpen, setIsAddMenuOpen] = useState(false);
  const addMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsMenuOpen(false);
      }
      if (colorMenuRef.current && !colorMenuRef.current.contains(e.target as Node)) {
        setIsColorMenuOpen(false);
      }
      if (addMenuRef.current && !addMenuRef.current.contains(e.target as Node)) {
        setIsAddMenuOpen(false);
      }
    };
    if (isMenuOpen || isColorMenuOpen || isAddMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isMenuOpen, isColorMenuOpen, isAddMenuOpen]);

  const currentFontFamily = selectedTextElement?.fontFamily ?? defaultFontFamily;
  const currentFontSize = selectedTextElement?.fontSize ?? defaultFontSize;
  const isBold = selectedTextElement?.isBold ?? false;
  const currentTextColor = selectedTextElement?.color ?? defaultColor;

  const handleFontChange = (e: ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    setDefaultFontFamily(val);
    if (selectedTextElement) {
      updateElement(selectedTextElement.id, { fontFamily: val }, true);
    }
  };

  const handleSizeChange = (e: ChangeEvent<HTMLSelectElement>) => {
    const val = Number(e.target.value);
    setDefaultFontSize(val);
    if (selectedTextElement) {
      updateElement(selectedTextElement.id, { fontSize: val }, true);
    }
  };

  const handleToggleBold = () => {
    if (selectedTextElement) {
      const nextBold = !selectedTextElement.isBold;
      updateElement(selectedTextElement.id, { isBold: nextBold }, true);
      window.dispatchEvent(new CustomEvent('inkwell-text-bold', { detail: { id: selectedTextElement.id, isBold: nextBold } }));
    } else {
      window.dispatchEvent(new CustomEvent('inkwell-text-bold', { detail: {} }));
    }
  };

  const handleColorSelect = (col: string) => {
    setDefaultColor(col);
    setIsColorMenuOpen(false);
    if (selectedTextElement) {
      updateElement(selectedTextElement.id, { color: col }, true);
      window.dispatchEvent(new CustomEvent('inkwell-text-color', { detail: { id: selectedTextElement.id, color: col } }));
    } else {
      window.dispatchEvent(new CustomEvent('inkwell-text-color', { detail: { color: col } }));
    }
  };

  const handleClearCanvas = () => {
    setIsMenuOpen(false);
    if (window.confirm('Are you sure you want to clear the entire canvas in this section?')) {
      clearCanvas();
    }
  };

  return (
    <div className="absolute top-10 left-1/2 -translate-x-1/2 z-40 h-11 flex items-center gap-2 rounded-2xl bg-white/90 dark:bg-[#262626]/95 backdrop-blur-2xl border border-black/[0.08] dark:border-white/[0.1] shadow-[0_8px_30px_rgba(0,0,0,0.08)] dark:shadow-[0_8px_30px_rgba(0,0,0,0.35)] px-2.5 py-1.5 select-none no-drag transition-colors max-w-[calc(100vw-2rem)]">
      {/* Unified "Add" file import button with dropdown */}
      <div ref={addMenuRef} className="relative flex items-center shrink-0 no-drag">
        <button
          type="button"
          onClick={() => setIsAddMenuOpen((prev) => !prev)}
          title="Add PDF, presentation, or image"
          className={`h-8 px-3 rounded-xl text-xs font-medium flex items-center gap-1.5 transition cursor-pointer border shrink-0 whitespace-nowrap ${
            isAddMenuOpen
              ? 'bg-black text-white dark:bg-white dark:text-black border-transparent shadow-xs'
              : 'bg-gray-100/90 hover:bg-gray-200/80 dark:bg-[#333333] dark:hover:bg-[#3e3e3e] active:scale-95 text-gray-800 dark:text-gray-200 border-black/[0.04] dark:border-white/[0.06]'
          }`}
        >
          <FileUp size={14} className="shrink-0" />
          <span>Add</span>
          <ChevronDown size={11} className={`shrink-0 transition-transform ${isAddMenuOpen ? 'rotate-180' : ''}`} />
        </button>

        {isAddMenuOpen && (
          <div className="absolute left-0 top-full mt-2 w-44 rounded-xl bg-white/95 dark:bg-[#262626]/98 backdrop-blur-2xl shadow-[0_12px_32px_rgba(0,0,0,0.15)] dark:shadow-[0_12px_32px_rgba(0,0,0,0.5)] border border-black/[0.08] dark:border-white/[0.1] p-1.5 z-50 animate-fade-in no-drag">
            <button
              type="button"
              onClick={() => { setIsAddMenuOpen(false); onAddPdfClick(); }}
              className="w-full px-3 py-2 rounded-lg text-left text-xs text-gray-800 dark:text-gray-200 hover:bg-black/[0.04] dark:hover:bg-white/[0.08] transition flex items-center gap-2.5 cursor-pointer font-medium no-drag"
            >
              <FileUp size={13} className="text-gray-500 dark:text-gray-400 shrink-0" />
              <span>PDF</span>
              <span className="ml-auto text-[10px] text-gray-400 font-mono">.pdf</span>
            </button>
            <button
              type="button"
              onClick={() => { setIsAddMenuOpen(false); onAddPptClick(); }}
              className="w-full px-3 py-2 rounded-lg text-left text-xs text-gray-800 dark:text-gray-200 hover:bg-black/[0.04] dark:hover:bg-white/[0.08] transition flex items-center gap-2.5 cursor-pointer font-medium no-drag"
            >
              <Presentation size={13} className="text-gray-500 dark:text-gray-400 shrink-0" />
              <span>Presentation</span>
              <span className="ml-auto text-[10px] text-gray-400 font-mono">.pptx</span>
            </button>
            <div className="border-t border-black/[0.06] dark:border-white/[0.08] my-1" />
            <button
              type="button"
              onClick={() => { setIsAddMenuOpen(false); onAddImageClick(); }}
              className="w-full px-3 py-2 rounded-lg text-left text-xs text-gray-800 dark:text-gray-200 hover:bg-black/[0.04] dark:hover:bg-white/[0.08] transition flex items-center gap-2.5 cursor-pointer font-medium no-drag"
            >
              <Paperclip size={13} className="text-gray-500 dark:text-gray-400 shrink-0" />
              <span>Image</span>
              <span className="ml-auto text-[10px] text-gray-400 font-mono">png/jpg…</span>
            </button>
          </div>
        )}
      </div>

      {/* Hand / Select / Arrow tool segmented toggle */}
      <div className="flex items-center p-0.5 rounded-xl bg-gray-100/90 dark:bg-[#333333] border border-black/[0.04] dark:border-white/[0.06] h-8 shrink-0">
        <button
          type="button"
          onClick={() => setActiveTool('hand')}
          title="Hand Tool (Pan canvas) — H"
          className={`w-7 h-7 rounded-lg flex items-center justify-center transition cursor-pointer ${
            activeTool === 'hand'
              ? 'bg-black text-white dark:bg-white dark:text-black shadow-sm font-semibold'
              : 'text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200'
          }`}
        >
          <Hand size={14} />
        </button>
        <button
          type="button"
          onClick={() => setActiveTool('select')}
          title="Select Tool — V"
          className={`w-7 h-7 rounded-lg flex items-center justify-center transition cursor-pointer ${
            activeTool === 'select'
              ? 'bg-black text-white dark:bg-white dark:text-black shadow-sm font-semibold'
              : 'text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200'
          }`}
        >
          <MousePointer2 size={14} />
        </button>
        <button
          type="button"
          onClick={() => {
            if (activeTool === 'arrow') {
              window.dispatchEvent(new CustomEvent('inkwell-flip-arrow-draft'));
            } else {
              setActiveTool('arrow');
            }
          }}
          title="Curved Arrow Tool — A (Press 'a' while drawing to flip curve)"
          className={`w-7 h-7 rounded-lg flex items-center justify-center transition cursor-pointer ${
            activeTool === 'arrow'
              ? 'bg-black text-white dark:bg-white dark:text-black shadow-sm font-semibold'
              : 'text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200'
          }`}
        >
          <CornerUpRight size={14} />
        </button>
      </div>

      {/* Segmented font controls */}
      <div className="flex items-center rounded-xl bg-gray-100/90 dark:bg-[#333333] border border-black/[0.04] dark:border-white/[0.06] h-8 px-1 shrink-0">
        {/* Font Family selector */}
        <div className="relative flex items-center">
          <Type size={13} className="text-gray-400 dark:text-gray-400 ml-1.5 shrink-0" />
          <select
            value={currentFontFamily}
            onChange={handleFontChange}
            className="appearance-none bg-transparent pl-1.5 pr-5 text-gray-800 dark:text-gray-200 text-xs font-medium focus:outline-none cursor-pointer"
          >
            {FONT_FAMILIES.map((f) => (
              <option key={f.label} value={f.value} className="bg-white dark:bg-[#262626] text-gray-900 dark:text-gray-100">
                {f.label}
              </option>
            ))}
          </select>
          <ChevronDown
            size={12}
            className="pointer-events-none absolute right-1.5 text-gray-400"
          />
        </div>

        {/* Separator line */}
        <div className="w-[1px] h-3.5 bg-gray-300/80 dark:bg-white/10 mx-1" />

        {/* Font Size selector */}
        <div className="relative flex items-center">
          <select
            value={currentFontSize}
            onChange={handleSizeChange}
            className="appearance-none bg-transparent px-1.5 pr-4 text-gray-800 dark:text-gray-200 text-xs font-medium focus:outline-none cursor-pointer"
          >
            {FONT_SIZES.map((s) => (
              <option key={s} value={s} className="bg-white dark:bg-[#262626] text-gray-900 dark:text-gray-100">
                {s}
              </option>
            ))}
          </select>
          <ChevronDown
            size={12}
            className="pointer-events-none absolute right-1 text-gray-400"
          />
        </div>

        {/* Separator line */}
        <div className="w-[1px] h-3.5 bg-gray-300/80 dark:bg-white/10 mx-1" />

        {/* Bold Button */}
        <button
          type="button"
          onClick={handleToggleBold}
          title="Toggle Bold"
          className={`w-6 h-6 rounded-lg flex items-center justify-center transition cursor-pointer ${
            isBold
              ? 'bg-black text-white dark:bg-white dark:text-black shadow-xs font-bold'
              : 'text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-black/[0.05] dark:hover:bg-white/[0.08]'
          }`}
        >
          <Bold size={13} strokeWidth={isBold ? 3 : 2.2} />
        </button>

        {/* Separator line */}
        <div className="w-[1px] h-3.5 bg-gray-300/80 dark:bg-white/10 mx-1" />

        {/* Text Color Picker button & Popover */}
        <div ref={colorMenuRef} className="relative flex items-center">
          <button
            type="button"
            onClick={() => setIsColorMenuOpen(!isColorMenuOpen)}
            title="Text Color"
            className="h-6 px-1.5 rounded-lg flex items-center gap-1 text-gray-700 dark:text-gray-300 hover:bg-black/[0.05] dark:hover:bg-white/[0.08] transition cursor-pointer"
          >
            <div className="flex flex-col items-center justify-center -space-y-0.5">
              <span className="font-bold text-[11px] leading-none">A</span>
              <span
                className="w-3.5 h-[2.5px] rounded-full"
                style={{
                  backgroundColor: currentTextColor
                    ? currentTextColor
                    : theme === 'dark'
                    ? '#ECECEC'
                    : '#111827',
                }}
              />
            </div>
            <ChevronDown size={10} className="text-gray-400" />
          </button>

          {/* Color Palette Popover */}
          {isColorMenuOpen && (
            <div className="absolute top-full right-0 mt-2 p-2.5 rounded-xl bg-white/95 dark:bg-[#262626]/98 backdrop-blur-2xl shadow-[0_12px_32px_rgba(0,0,0,0.15)] dark:shadow-[0_12px_32px_rgba(0,0,0,0.5)] border border-black/10 dark:border-white/10 z-50 animate-fade-in no-drag w-44">
              <div className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-2 px-1">
                Text Color
              </div>
              <div className="grid grid-cols-5 gap-1.5 mb-2">
                {TEXT_COLORS.map((tc) => {
                  const isSelectedColor =
                    tc.value === ''
                      ? !currentTextColor
                      : currentTextColor.toLowerCase() === tc.value.toLowerCase();
                  return (
                    <button
                      key={tc.label}
                      type="button"
                      onClick={() => handleColorSelect(tc.value)}
                      title={tc.label}
                      className={`w-6 h-6 rounded-full flex items-center justify-center transition-transform hover:scale-110 cursor-pointer border ${
                        isSelectedColor
                          ? 'ring-2 ring-blue-500 ring-offset-1 dark:ring-offset-[#262626]'
                          : 'border-black/15 dark:border-white/20'
                      }`}
                      style={{
                        backgroundColor:
                          tc.value === ''
                            ? theme === 'dark'
                              ? '#ECECEC'
                              : '#111827'
                            : tc.value,
                      }}
                    >
                      {tc.value === '' && (
                        <span className="text-[9px] font-bold text-white dark:text-black">
                          A
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Custom Hex Color Picker */}
              <div className="border-t border-black/[0.06] dark:border-white/[0.08] pt-2 mt-1 flex items-center justify-between px-1">
                <label className="text-[11px] text-gray-600 dark:text-gray-400 font-medium cursor-pointer flex items-center gap-1.5">
                  <Palette size={12} />
                  <span>Custom</span>
                </label>
                <input
                  type="color"
                  value={currentTextColor || (theme === 'dark' ? '#ececec' : '#111827')}
                  onChange={(e) => handleColorSelect(e.target.value)}
                  className="w-5 h-5 rounded-md border-0 bg-transparent cursor-pointer p-0"
                  title="Choose custom color"
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Divider before more options */}
      <div className="h-4 w-[1px] bg-black/10 dark:bg-white/10 shrink-0 mx-0.5" />

      {/* More / Overflow menu */}
      <div ref={menuRef} className="relative flex items-center shrink-0 no-drag">
        <button
          type="button"
          onClick={() => setIsMenuOpen(!isMenuOpen)}
          title="More options"
          className={`w-8 h-8 rounded-xl flex items-center justify-center transition cursor-pointer border shrink-0 no-drag ${
            isMenuOpen
              ? 'bg-black text-white dark:bg-white dark:text-black border-transparent shadow-xs'
              : 'bg-gray-100/90 hover:bg-gray-200/80 dark:bg-[#333333] dark:hover:bg-[#3e3e3e] active:scale-95 text-gray-700 dark:text-gray-200 border-black/[0.04] dark:border-white/[0.06]'
          }`}
        >
          <MoreVertical size={15} />
        </button>

        {isMenuOpen && (
          <div className="absolute right-0 top-full mt-2 w-52 rounded-2xl bg-white/95 dark:bg-[#262626]/98 backdrop-blur-2xl shadow-[0_16px_36px_rgba(0,0,0,0.18)] dark:shadow-[0_16px_36px_rgba(0,0,0,0.5)] border border-black/[0.08] dark:border-white/[0.1] p-1.5 z-50 animate-fade-in no-drag">
            {/* Dark Mode Toggle Button */}
            <button
              type="button"
              onClick={() => {
                toggleTheme();
              }}
              className="w-full px-3 py-2 rounded-lg text-left text-xs text-gray-800 dark:text-gray-200 hover:bg-black/[0.04] dark:hover:bg-white/[0.08] transition flex items-center justify-between cursor-pointer font-medium no-drag"
            >
              <div className="flex items-center gap-2">
                {theme === 'dark' ? (
                  <Sun size={14} className="text-amber-400" />
                ) : (
                  <Moon size={14} className="text-gray-500" />
                )}
                <span>{theme === 'dark' ? 'Light Mode' : 'Dark Mode'}</span>
              </div>
              <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-black/[0.05] dark:bg-white/[0.1] text-gray-500 dark:text-gray-400 capitalize font-mono">
                {theme}
              </span>
            </button>

            <div className="border-t border-black/[0.06] dark:border-white/[0.08] my-1" />

            <button
              type="button"
              onClick={() => {
                setIsMenuOpen(false);
                onExportPdfClick?.();
              }}
              className="w-full px-3 py-2 rounded-lg text-left text-xs text-gray-800 dark:text-gray-200 hover:bg-black/[0.04] dark:hover:bg-white/[0.08] transition flex items-center justify-between cursor-pointer font-medium no-drag"
            >
              <div className="flex items-center gap-2">
                <Download size={14} className="text-gray-500 dark:text-gray-400" />
                <span>Export as PDF</span>
              </div>
            </button>
            <button
              type="button"
              onClick={() => {
                resetViewport();
                setIsMenuOpen(false);
              }}
              className="w-full px-3 py-2 rounded-lg text-left text-xs text-gray-800 dark:text-gray-200 hover:bg-black/[0.04] dark:hover:bg-white/[0.08] transition flex items-center justify-between cursor-pointer font-medium no-drag"
            >
              <div className="flex items-center gap-2">
                <RotateCcw size={14} className="text-gray-500 dark:text-gray-400" />
                <span>Reset View</span>
              </div>
              <span className="text-[10px] text-gray-400 font-mono">{modKey}0</span>
            </button>
            <div className="border-t border-black/[0.06] dark:border-white/[0.08] my-1" />
            <button
              type="button"
              onClick={handleClearCanvas}
              className="w-full px-3 py-2 rounded-lg text-left text-xs text-red-600 dark:text-red-400 hover:bg-red-500/10 dark:hover:bg-red-500/20 transition flex items-center gap-2 cursor-pointer font-medium no-drag"
            >
              <Trash2 size={14} />
              <span>Clear Canvas</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

