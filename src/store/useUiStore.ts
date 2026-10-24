import { create } from 'zustand';
import { CanvasElement, TextDefaults, ToolMode, UiState } from '../types';

interface UiStore extends UiState {
  setSelectedId: (id: string | null) => void;
  setSelectedIds: (ids: string[]) => void;
  toggleSelectedId: (id: string) => void;
  clearSelection: () => void;
  setEditingId: (id: string | null) => void;
  setSidebarOpen: (isOpen: boolean) => void;
  toggleSidebar: () => void;
  setIsImporting: (isImporting: boolean) => void;
  setImportProgress: (progress: { done: number; total: number } | null) => void;
  setActiveTool: (tool: ToolMode) => void;
  setClipboardElements: (elements: CanvasElement[] | null) => void;
  incrementPasteCount: () => void;
  resetPasteCount: () => void;
  setTextDefaults: (patch: Partial<TextDefaults>) => void;
  resetUi: () => void;
}

const TEXT_DEFAULTS_STORAGE_KEY = 'inkwell_text_defaults';

const DEFAULT_TEXT_DEFAULTS: TextDefaults = {
  fontFamily: 'Comic Sans MS, Comic Neue, cursive, sans-serif',
  fontSize: 18,
  color: '',
  isBold: false,
};

function loadTextDefaults(): TextDefaults {
  try {
    const raw = localStorage.getItem(TEXT_DEFAULTS_STORAGE_KEY);
    if (!raw) return DEFAULT_TEXT_DEFAULTS;

    const parsed = JSON.parse(raw) as Partial<TextDefaults>;
    return {
      fontFamily:
        typeof parsed.fontFamily === 'string'
          ? parsed.fontFamily
          : DEFAULT_TEXT_DEFAULTS.fontFamily,
      fontSize:
        typeof parsed.fontSize === 'number' && parsed.fontSize > 0
          ? parsed.fontSize
          : DEFAULT_TEXT_DEFAULTS.fontSize,
      color: typeof parsed.color === 'string' ? parsed.color : DEFAULT_TEXT_DEFAULTS.color,
      isBold:
        typeof parsed.isBold === 'boolean' ? parsed.isBold : DEFAULT_TEXT_DEFAULTS.isBold,
    };
  } catch {
    return DEFAULT_TEXT_DEFAULTS;
  }
}

const initialState: UiState = {
  selectedId: null,
  selectedIds: [],
  editingId: null,
  isSidebarOpen: true,
  isImporting: false,
  importProgress: null,
  activeTool: 'select',
  clipboardElements: null,
  pasteCount: 0,
  textDefaults: loadTextDefaults(),
};

export const useUiStore = create<UiStore>((set) => ({
  ...initialState,
  setSelectedId: (id) =>
    set({
      selectedId: id,
      selectedIds: id ? [id] : [],
    }),
  setSelectedIds: (ids) =>
    set({
      selectedIds: ids,
      selectedId: null,
    }),
  toggleSelectedId: (id) =>
    set((state) => {
      const exists = state.selectedIds.includes(id);
      const nextIds = exists
        ? state.selectedIds.filter((item) => item !== id)
        : [...state.selectedIds, id];
      return {
        selectedIds: nextIds,
        selectedId: nextIds.length > 0 ? nextIds[nextIds.length - 1] : null,
      };
    }),
  clearSelection: () =>
    set({
      selectedId: null,
      selectedIds: [],
    }),
  setEditingId: (id) => set({ editingId: id }),
  setSidebarOpen: (isOpen) => set({ isSidebarOpen: isOpen }),
  toggleSidebar: () => set((state) => ({ isSidebarOpen: !state.isSidebarOpen })),
  setIsImporting: (isImporting) => set({ isImporting }),
  setImportProgress: (importProgress) => set({ importProgress }),
  setActiveTool: (activeTool) => set({ activeTool }),
  setClipboardElements: (clipboardElements) => set({ clipboardElements, pasteCount: 0 }),
  incrementPasteCount: () => set((state) => ({ pasteCount: (state.pasteCount || 0) + 1 })),
  resetPasteCount: () => set({ pasteCount: 0 }),
  setTextDefaults: (patch) =>
    set((state) => {
      const textDefaults = { ...state.textDefaults, ...patch };
      try {
        localStorage.setItem(TEXT_DEFAULTS_STORAGE_KEY, JSON.stringify(textDefaults));
      } catch {
        // Storage may be unavailable — defaults still apply for this session.
      }
      return { textDefaults };
    }),
  resetUi: () => set(initialState),
}));
