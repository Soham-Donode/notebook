import { create } from 'zustand';
import { CanvasElement, ToolMode, UiState } from '../types';

export const DEFAULT_FONT_FAMILY = 'Comic Sans MS, Comic Neue, cursive, sans-serif';

interface UiStore extends UiState {
  defaultFontFamily: string;
  defaultFontSize: number;
  defaultColor: string;
  setDefaultFontFamily: (v: string) => void;
  setDefaultFontSize: (v: number) => void;
  setDefaultColor: (v: string) => void;
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
  resetUi: () => void;
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
};

export const useUiStore = create<UiStore>((set) => ({
  ...initialState,
  defaultFontFamily: DEFAULT_FONT_FAMILY,
  defaultFontSize: 18,
  defaultColor: '',
  setDefaultFontFamily: (defaultFontFamily) => set({ defaultFontFamily }),
  setDefaultFontSize: (defaultFontSize) => set({ defaultFontSize }),
  setDefaultColor: (defaultColor) => set({ defaultColor }),
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
  resetUi: () => set(initialState),
}));
