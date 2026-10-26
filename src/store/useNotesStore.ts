import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  type CanvasElement,
  type Notebook,
  SCHEMA_VERSION,
  type Section,
  type Viewport,
} from '../types.ts';
import { deletePageImage } from './imageStore.ts';
import { calculateTargetZoom } from '../utils/canvasMath.ts';
import {
  saveNotebooksToDisk,
  saveNotebookToDisk,
  loadNotebooksFromDisk,
  deleteNotebookFromDisk,
} from '../services/storageService.ts';
import { useUiStore } from './useUiStore.ts';

const MAX_UNDO_STEPS = 50;

interface NotesState {
  notebooks: Notebook[];
  activeNotebookId: string | null;
  activeSectionId: string | null;

  // In-memory undo/redo stacks (not persisted)
  undoStacks: Record<string, CanvasElement[][]>;
  redoStacks: Record<string, CanvasElement[][]>;

  // Actions
  createNotebook: (name: string) => Notebook;
  deleteNotebook: (id: string) => Promise<void>;
  setActiveNotebook: (id: string | null) => void;
  renameNotebook: (id: string, name: string) => void;

  addSection: (notebookId: string, name?: string) => Section;
  renameSection: (notebookId: string, sectionId: string, name: string) => void;
  moveSection: (notebookId: string, sectionId: string, toIndex: number) => void;
  deleteSection: (notebookId: string, sectionId: string) => Promise<void>;
  setActiveSection: (sectionId: string | null) => void;
  navigateToSection: (notebookId: string, sectionId: string) => void;

  setViewport: (viewport: Partial<Viewport>) => void;
  resetViewport: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  setZoomLevel: (zoom: number) => void;

  addElement: (element: CanvasElement) => void;
  addElements: (elements: CanvasElement[]) => void;
  updateElement: (id: string, patch: Partial<CanvasElement>, commitUndo?: boolean) => void;
  moveElement: (id: string, x: number, y: number, commitUndo?: boolean) => void;
  moveElements: (ids: string[], dx: number, dy: number, commitUndo?: boolean) => void;
  deleteElement: (id: string) => Promise<void>;
  deleteElements: (ids: string[]) => Promise<void>;
  clearCanvas: () => Promise<void>;

  commitUndoSnapshot: () => void;
  undo: () => void;
  redo: () => void;

  // Import / Export helper
  setNotebooks: (notebooks: Notebook[]) => void;
  addNotebook: (notebook: Notebook) => void;
  hydrateFromDisk: () => Promise<void>;
}

function cloneElements(elements: CanvasElement[]): CanvasElement[] {
  return JSON.parse(JSON.stringify(elements));
}

export const useNotesStore = create<NotesState>()(
  persist(
    (set, get) => ({
      notebooks: [],
      activeNotebookId: null,
      activeSectionId: null,
      undoStacks: {},
      redoStacks: {},

      createNotebook: (name: string) => {
        const initialSection: Section = {
          id: crypto.randomUUID(),
          name: 'Section 1',
          viewport: { x: 0, y: 0, zoom: 1 },
          elements: [],
        };

        const newNotebook: Notebook = {
          id: crypto.randomUUID(),
          name: name.trim(),
          createdAt: Date.now(),
          updatedAt: Date.now(),
          sections: [initialSection],
        };

        const nextNbs = [newNotebook, ...get().notebooks];
        set({
          notebooks: nextNbs,
          activeNotebookId: newNotebook.id,
          activeSectionId: initialSection.id,
        });

        saveNotebooksToDisk(nextNbs).catch(console.error);

        return newNotebook;
      },

      deleteNotebook: async (id: string) => {
        const notebook = get().notebooks.find((nb) => nb.id === id);
        if (notebook) {
          for (const sec of notebook.sections) {
            for (const el of sec.elements) {
              if ((el.type === 'pdf-page' || el.type === 'image') && el.imageKey) {
                await deletePageImage(el.imageKey);
              }
            }
          }
          await deleteNotebookFromDisk(notebook);
          if (typeof window !== 'undefined') {
            window.dispatchEvent(
              new CustomEvent('notebook-toast', {
                detail: `Notebook "${notebook.name}" deleted`,
              })
            );
          }
        }

        set((state) => {
          const nextNotebooks = state.notebooks.filter((nb) => nb.id !== id);
          let nextActiveNotebookId = state.activeNotebookId;
          let nextActiveSectionId = state.activeSectionId;

          if (state.activeNotebookId === id) {
            if (nextNotebooks.length > 0) {
              nextActiveNotebookId = nextNotebooks[0].id;
              nextActiveSectionId = nextNotebooks[0].sections[0]?.id ?? null;
            } else {
              nextActiveNotebookId = null;
              nextActiveSectionId = null;
            }
          }

          return {
            notebooks: nextNotebooks,
            activeNotebookId: nextActiveNotebookId,
            activeSectionId: nextActiveSectionId,
          };
        });
      },

      setActiveNotebook: (id: string | null) => {
        if (!id) {
          set({ activeNotebookId: null, activeSectionId: null });
          return;
        }
        try {
          localStorage.setItem('notebook_last_opened_notebook', id);
        } catch (_) {}
        const notebook = get().notebooks.find((nb) => nb.id === id);
        set({
          activeNotebookId: id,
          activeSectionId: notebook?.sections[0]?.id ?? null,
        });
      },

      renameNotebook: (id: string, name: string) => {
        const trimmed = name.trim();
        if (!trimmed) return;
        set((state) => ({
          notebooks: state.notebooks.map((nb) =>
            nb.id === id ? { ...nb, name: trimmed, updatedAt: Date.now() } : nb
          ),
        }));
        const updated = get().notebooks.find((nb) => nb.id === id);
        if (updated) {
          saveNotebookToDisk(updated).catch(console.error);
        }
      },

      addSection: (notebookId: string, name?: string) => {
        const notebook = get().notebooks.find((nb) => nb.id === notebookId);
        const sectionName = name !== undefined ? name : `Section ${(notebook?.sections.length ?? 0) + 1}`;

        const newSection: Section = {
          id: crypto.randomUUID(),
          name: sectionName,
          viewport: { x: 0, y: 0, zoom: 1 },
          elements: [],
        };

        set((state) => ({
          notebooks: state.notebooks.map((nb) =>
            nb.id === notebookId
              ? {
                  ...nb,
                  updatedAt: Date.now(),
                  sections: [...nb.sections, newSection],
                }
              : nb
          ),
          activeSectionId: newSection.id,
        }));

        return newSection;
      },

      renameSection: (notebookId: string, sectionId: string, name: string) => {
        set((state) => ({
          notebooks: state.notebooks.map((nb) =>
            nb.id === notebookId
              ? {
                  ...nb,
                  updatedAt: Date.now(),
                  sections: nb.sections.map((sec) =>
                    sec.id === sectionId ? { ...sec, name } : sec
                  ),
                }
              : nb
          ),
        }));
      },

      moveSection: (notebookId: string, sectionId: string, toIndex: number) => {
        set((state) => ({
          notebooks: state.notebooks.map((nb) => {
            if (nb.id !== notebookId) return nb;

            const fromIndex = nb.sections.findIndex((sec) => sec.id === sectionId);
            if (fromIndex === -1) return nb;

            const sections = [...nb.sections];
            const [moved] = sections.splice(fromIndex, 1);
            const target = Math.max(0, Math.min(toIndex, sections.length));
            sections.splice(target, 0, moved);

            if (sections.every((sec, index) => sec.id === nb.sections[index]?.id)) {
              return nb;
            }

            return { ...nb, updatedAt: Date.now(), sections };
          }),
        }));
      },

      deleteSection: async (notebookId: string, sectionId: string) => {
        const notebook = get().notebooks.find((nb) => nb.id === notebookId);
        const section = notebook?.sections.find((s) => s.id === sectionId);
        if (section) {
          for (const el of section.elements) {
            if ((el.type === 'pdf-page' || el.type === 'image') && el.imageKey) {
              await deletePageImage(el.imageKey);
            }
          }
        }

        set((state) => {
          const nextNotebooks = state.notebooks.map((nb) => {
            if (nb.id !== notebookId) return nb;
            return {
              ...nb,
              updatedAt: Date.now(),
              sections: nb.sections.filter((s) => s.id !== sectionId),
            };
          });

          let nextActiveSectionId = state.activeSectionId;
          if (state.activeSectionId === sectionId) {
            const currentNb = nextNotebooks.find((nb) => nb.id === notebookId);
            nextActiveSectionId = currentNb?.sections[0]?.id ?? null;
          }

          return {
            notebooks: nextNotebooks,
            activeSectionId: nextActiveSectionId,
          };
        });
      },

      setActiveSection: (sectionId: string | null) => {
        set({ activeSectionId: sectionId });
      },

      navigateToSection: (notebookId: string, sectionId: string) => {
        try {
          localStorage.setItem('notebook_last_opened_notebook', notebookId);
        } catch (_) {}
        set({
          activeNotebookId: notebookId,
          activeSectionId: sectionId,
        });
      },

      setViewport: (viewport: Partial<Viewport>) => {
        const { activeNotebookId, activeSectionId } = get();
        if (!activeNotebookId || !activeSectionId) return;

        set((state) => ({
          notebooks: state.notebooks.map((nb) =>
            nb.id === activeNotebookId
              ? {
                  ...nb,
                  sections: nb.sections.map((sec) =>
                    sec.id === activeSectionId
                      ? { ...sec, viewport: { ...sec.viewport, ...viewport } }
                      : sec
                  ),
                }
              : nb
          ),
        }));
      },

      resetViewport: () => {
        const { activeNotebookId, activeSectionId, notebooks } = get();
        const section = notebooks
          .find((n) => n.id === activeNotebookId)
          ?.sections.find((s) => s.id === activeSectionId);

        const SIDE_PADDING = 60;
        const TOP_PADDING = 90;

        if (!section || section.elements.length === 0) {
          get().setViewport({ x: SIDE_PADDING, y: TOP_PADDING, zoom: 1 });
          return;
        }

        // Check if an item is currently selected in useUiStore
        const { selectedId, selectedIds } = useUiStore.getState();
        const activeSelectedId = selectedId || selectedIds[0];
        let targetElement: CanvasElement | undefined;
        if (activeSelectedId) {
          targetElement = section.elements.find((el) => el.id === activeSelectedId);
        }

        let targetX = Infinity;
        let targetY = Infinity;

        if (targetElement) {
          if (targetElement.type === 'arrow') {
            targetX = Math.min(targetElement.startX, targetElement.endX);
            targetY = Math.min(targetElement.startY, targetElement.endY);
          } else {
            targetX = targetElement.x;
            targetY = targetElement.y;
          }
        } else {
          for (const el of section.elements) {
            if (el.type === 'arrow') {
              targetX = Math.min(targetX, el.startX, el.endX);
              targetY = Math.min(targetY, el.startY, el.endY);
            } else {
              targetX = Math.min(targetX, el.x);
              targetY = Math.min(targetY, el.y);
            }
          }
        }

        if (!isFinite(targetX) || !isFinite(targetY)) {
          targetX = 0;
          targetY = 0;
        }

        // Align viewport so the top-left corner of the item matches the top-left corner of the viewport with padding
        const targetViewportX = Math.round(SIDE_PADDING - targetX);
        const targetViewportY = Math.round(TOP_PADDING - targetY);

        get().setViewport({ x: targetViewportX, y: targetViewportY, zoom: 1 });
      },

      zoomIn: () => {
        const { activeNotebookId, activeSectionId, notebooks } = get();
        if (!activeNotebookId || !activeSectionId) return;
        const section = notebooks
          .find((n) => n.id === activeNotebookId)
          ?.sections.find((s) => s.id === activeSectionId);
        if (!section) return;

        const container = document.getElementById('infinite-canvas-container');
        const rect = container?.getBoundingClientRect() ?? {
          width: window.innerWidth - 280,
          height: window.innerHeight,
        };
        const next = calculateTargetZoom(
          rect.width / 2,
          rect.height / 2,
          section.viewport.zoom * 1.2,
          section.viewport
        );
        get().setViewport(next);
      },

      zoomOut: () => {
        const { activeNotebookId, activeSectionId, notebooks } = get();
        if (!activeNotebookId || !activeSectionId) return;
        const section = notebooks
          .find((n) => n.id === activeNotebookId)
          ?.sections.find((s) => s.id === activeSectionId);
        if (!section) return;

        const container = document.getElementById('infinite-canvas-container');
        const rect = container?.getBoundingClientRect() ?? {
          width: window.innerWidth - 280,
          height: window.innerHeight,
        };
        const next = calculateTargetZoom(
          rect.width / 2,
          rect.height / 2,
          section.viewport.zoom / 1.2,
          section.viewport
        );
        get().setViewport(next);
      },

      setZoomLevel: (targetZoom: number) => {
        const { activeNotebookId, activeSectionId, notebooks } = get();
        if (!activeNotebookId || !activeSectionId) return;
        const section = notebooks
          .find((n) => n.id === activeNotebookId)
          ?.sections.find((s) => s.id === activeSectionId);
        if (!section) return;

        const container = document.getElementById('infinite-canvas-container');
        const rect = container?.getBoundingClientRect() ?? {
          width: window.innerWidth - 280,
          height: window.innerHeight,
        };
        const next = calculateTargetZoom(
          rect.width / 2,
          rect.height / 2,
          targetZoom,
          section.viewport
        );
        get().setViewport(next);
      },

      addElement: (element: CanvasElement) => {
        const { activeNotebookId, activeSectionId, notebooks, undoStacks } = get();
        if (!activeNotebookId || !activeSectionId) return;

        const currentSection = notebooks
          .find((nb) => nb.id === activeNotebookId)
          ?.sections.find((sec) => sec.id === activeSectionId);

        if (!currentSection) return;

        const currentElements = currentSection.elements;
        const currentStack = undoStacks[activeSectionId] || [];
        const nextStack = [...currentStack, cloneElements(currentElements)].slice(-MAX_UNDO_STEPS);

        set((state) => ({
          undoStacks: { ...state.undoStacks, [activeSectionId]: nextStack },
          redoStacks: { ...state.redoStacks, [activeSectionId]: [] },
          notebooks: state.notebooks.map((nb) =>
            nb.id === activeNotebookId
              ? {
                  ...nb,
                  updatedAt: Date.now(),
                  sections: nb.sections.map((sec) =>
                    sec.id === activeSectionId
                      ? { ...sec, elements: [...sec.elements, element] }
                      : sec
                  ),
                }
              : nb
          ),
        }));
      },

      addElements: (elements: CanvasElement[]) => {
        const { activeNotebookId, activeSectionId, notebooks, undoStacks } = get();
        if (!activeNotebookId || !activeSectionId || elements.length === 0) return;

        const currentSection = notebooks
          .find((nb) => nb.id === activeNotebookId)
          ?.sections.find((sec) => sec.id === activeSectionId);

        if (!currentSection) return;

        const currentElements = currentSection.elements;
        const currentStack = undoStacks[activeSectionId] || [];
        const nextStack = [...currentStack, cloneElements(currentElements)].slice(-MAX_UNDO_STEPS);

        set((state) => ({
          undoStacks: { ...state.undoStacks, [activeSectionId]: nextStack },
          redoStacks: { ...state.redoStacks, [activeSectionId]: [] },
          notebooks: state.notebooks.map((nb) =>
            nb.id === activeNotebookId
              ? {
                  ...nb,
                  updatedAt: Date.now(),
                  sections: nb.sections.map((sec) =>
                    sec.id === activeSectionId
                      ? { ...sec, elements: [...sec.elements, ...elements] }
                      : sec
                  ),
                }
              : nb
          ),
        }));
      },

      updateElement: (id: string, patch: Partial<CanvasElement>, commitUndo = true) => {
        const { activeNotebookId, activeSectionId, notebooks, undoStacks } = get();
        if (!activeNotebookId || !activeSectionId) return;

        const currentSection = notebooks
          .find((nb) => nb.id === activeNotebookId)
          ?.sections.find((sec) => sec.id === activeSectionId);

        if (!currentSection) return;

        let nextUndoStacks = undoStacks;
        let nextRedoStacks = get().redoStacks;

        if (commitUndo) {
          const currentStack = undoStacks[activeSectionId] || [];
          nextUndoStacks = {
            ...undoStacks,
            [activeSectionId]: [...currentStack, cloneElements(currentSection.elements)].slice(-MAX_UNDO_STEPS),
          };
          nextRedoStacks = { ...nextRedoStacks, [activeSectionId]: [] };
        }

        set((state) => ({
          undoStacks: nextUndoStacks,
          redoStacks: nextRedoStacks,
          notebooks: state.notebooks.map((nb) =>
            nb.id === activeNotebookId
              ? {
                  ...nb,
                  updatedAt: Date.now(),
                  sections: nb.sections.map((sec) =>
                    sec.id === activeSectionId
                      ? {
                          ...sec,
                          elements: sec.elements.map((el) =>
                            el.id === id ? ({ ...el, ...patch } as CanvasElement) : el
                          ),
                        }
                      : sec
                  ),
                }
              : nb
          ),
        }));
      },

      moveElement: (id: string, x: number, y: number, commitUndo = false) => {
        const { activeNotebookId, activeSectionId, notebooks } = get();
        const currentSection = notebooks
          .find((nb) => nb.id === activeNotebookId)
          ?.sections.find((sec) => sec.id === activeSectionId);
        const el = currentSection?.elements.find((item) => item.id === id);
        if (el?.type === 'arrow') {
          const dx = x - el.x;
          const dy = y - el.y;
          get().moveElements([id], dx, dy, commitUndo);
          return;
        }
        get().updateElement(id, { x, y } as Partial<CanvasElement>, commitUndo);
      },

      moveElements: (ids: string[], dx: number, dy: number, commitUndo = false) => {
        const { activeNotebookId, activeSectionId, notebooks, undoStacks } = get();
        if (!activeNotebookId || !activeSectionId || ids.length === 0 || (dx === 0 && dy === 0)) return;

        const currentSection = notebooks
          .find((nb) => nb.id === activeNotebookId)
          ?.sections.find((sec) => sec.id === activeSectionId);

        if (!currentSection) return;

        const idSet = new Set(ids);
        let nextUndoStacks = undoStacks;
        let nextRedoStacks = get().redoStacks;

        if (commitUndo) {
          const currentStack = undoStacks[activeSectionId] || [];
          nextUndoStacks = {
            ...undoStacks,
            [activeSectionId]: [...currentStack, cloneElements(currentSection.elements)].slice(-MAX_UNDO_STEPS),
          };
          nextRedoStacks = { ...nextRedoStacks, [activeSectionId]: [] };
        }

        set((state) => ({
          undoStacks: nextUndoStacks,
          redoStacks: nextRedoStacks,
          notebooks: state.notebooks.map((nb) =>
            nb.id === activeNotebookId
              ? {
                  ...nb,
                  updatedAt: Date.now(),
                  sections: nb.sections.map((sec) =>
                    sec.id === activeSectionId
                      ? {
                          ...sec,
                          elements: sec.elements.map((el) => {
                            if (!idSet.has(el.id)) return el;
                            if (el.type === 'arrow') {
                              const nextStartX = el.startX + dx;
                              const nextStartY = el.startY + dy;
                              const nextEndX = el.endX + dx;
                              const nextEndY = el.endY + dy;
                              return {
                                ...el,
                                startX: nextStartX,
                                startY: nextStartY,
                                endX: nextEndX,
                                endY: nextEndY,
                                x: Math.min(nextStartX, nextEndX),
                                y: Math.min(nextStartY, nextEndY),
                              };
                            }
                            return {
                              ...el,
                              x: el.x + dx,
                              y: el.y + dy,
                            };
                          }),
                        }
                      : sec
                  ),
                }
              : nb
          ),
        }));
      },

      deleteElements: async (ids: string[]) => {
        const { activeNotebookId, activeSectionId, notebooks, undoStacks } = get();
        if (!activeNotebookId || !activeSectionId || ids.length === 0) return;

        const currentSection = notebooks
          .find((nb) => nb.id === activeNotebookId)
          ?.sections.find((sec) => sec.id === activeSectionId);

        if (!currentSection) return;

        const idSet = new Set(ids);
        // NOTE: We intentionally do NOT delete image blobs from IDB here.
        // Undo may restore these elements, and blobs must still be available.
        // Orphaned blobs are cleaned up by collectGarbage() on next app start.

        const currentStack = undoStacks[activeSectionId] || [];
        const nextStack = [...currentStack, cloneElements(currentSection.elements)].slice(-MAX_UNDO_STEPS);

        set((state) => ({
          undoStacks: { ...state.undoStacks, [activeSectionId]: nextStack },
          redoStacks: { ...state.redoStacks, [activeSectionId]: [] },
          notebooks: state.notebooks.map((nb) =>
            nb.id === activeNotebookId
              ? {
                  ...nb,
                  updatedAt: Date.now(),
                  sections: nb.sections.map((sec) =>
                    sec.id === activeSectionId
                      ? {
                          ...sec,
                          elements: sec.elements.filter((el) => !idSet.has(el.id)),
                        }
                      : sec
                  ),
                }
              : nb
          ),
        }));
      },

      deleteElement: async (id: string) => {
        await get().deleteElements([id]);
      },

      clearCanvas: async () => {
        const { activeNotebookId, activeSectionId, notebooks, undoStacks } = get();
        if (!activeNotebookId || !activeSectionId) return;

        const currentSection = notebooks
          .find((nb) => nb.id === activeNotebookId)
          ?.sections.find((sec) => sec.id === activeSectionId);

        if (!currentSection) return;

        // NOTE: We intentionally do NOT delete image blobs from IDB here.
        // Undo may restore these elements, and blobs must still be available.
        // Orphaned blobs are cleaned up by collectGarbage() on next app start.

        const currentStack = undoStacks[activeSectionId] || [];
        const nextStack = [...currentStack, cloneElements(currentSection.elements)].slice(-MAX_UNDO_STEPS);

        set((state) => ({
          undoStacks: { ...state.undoStacks, [activeSectionId]: nextStack },
          redoStacks: { ...state.redoStacks, [activeSectionId]: [] },
          notebooks: state.notebooks.map((nb) =>
            nb.id === activeNotebookId
              ? {
                  ...nb,
                  updatedAt: Date.now(),
                  sections: nb.sections.map((sec) =>
                    sec.id === activeSectionId ? { ...sec, elements: [] } : sec
                  ),
                }
              : nb
          ),
        }));
      },

      commitUndoSnapshot: () => {
        const { activeNotebookId, activeSectionId, notebooks, undoStacks } = get();
        if (!activeNotebookId || !activeSectionId) return;

        const currentSection = notebooks
          .find((nb) => nb.id === activeNotebookId)
          ?.sections.find((sec) => sec.id === activeSectionId);

        if (!currentSection) return;

        const currentStack = undoStacks[activeSectionId] || [];
        const nextStack = [...currentStack, cloneElements(currentSection.elements)].slice(-MAX_UNDO_STEPS);

        set((state) => ({
          undoStacks: { ...state.undoStacks, [activeSectionId]: nextStack },
          redoStacks: { ...state.redoStacks, [activeSectionId]: [] },
        }));
      },

      undo: () => {
        const { activeNotebookId, activeSectionId, notebooks, undoStacks, redoStacks } = get();
        if (!activeNotebookId || !activeSectionId) return;

        const stack = undoStacks[activeSectionId];
        if (!stack || stack.length === 0) return;

        const currentSection = notebooks
          .find((nb) => nb.id === activeNotebookId)
          ?.sections.find((sec) => sec.id === activeSectionId);

        if (!currentSection) return;

        const previousElements = stack[stack.length - 1];
        const nextUndoStack = stack.slice(0, -1);

        const currentRedoStack = redoStacks[activeSectionId] || [];
        const nextRedoStack = [...currentRedoStack, cloneElements(currentSection.elements)].slice(-MAX_UNDO_STEPS);

        set((state) => ({
          undoStacks: { ...state.undoStacks, [activeSectionId]: nextUndoStack },
          redoStacks: { ...state.redoStacks, [activeSectionId]: nextRedoStack },
          notebooks: state.notebooks.map((nb) =>
            nb.id === activeNotebookId
              ? {
                  ...nb,
                  updatedAt: Date.now(),
                  sections: nb.sections.map((sec) =>
                    sec.id === activeSectionId
                      ? { ...sec, elements: cloneElements(previousElements) }
                      : sec
                  ),
                }
              : nb
          ),
        }));
      },

      redo: () => {
        const { activeNotebookId, activeSectionId, notebooks, undoStacks, redoStacks } = get();
        if (!activeNotebookId || !activeSectionId) return;

        const stack = redoStacks[activeSectionId];
        if (!stack || stack.length === 0) return;

        const currentSection = notebooks
          .find((nb) => nb.id === activeNotebookId)
          ?.sections.find((sec) => sec.id === activeSectionId);

        if (!currentSection) return;

        const nextElements = stack[stack.length - 1];
        const nextRedoStack = stack.slice(0, -1);

        const currentUndoStack = undoStacks[activeSectionId] || [];
        const nextUndoStack = [...currentUndoStack, cloneElements(currentSection.elements)].slice(-MAX_UNDO_STEPS);

        set((state) => ({
          undoStacks: { ...state.undoStacks, [activeSectionId]: nextUndoStack },
          redoStacks: { ...state.redoStacks, [activeSectionId]: nextRedoStack },
          notebooks: state.notebooks.map((nb) =>
            nb.id === activeNotebookId
              ? {
                  ...nb,
                  updatedAt: Date.now(),
                  sections: nb.sections.map((sec) =>
                    sec.id === activeSectionId
                      ? { ...sec, elements: cloneElements(nextElements) }
                      : sec
                  ),
                }
              : nb
          ),
        }));
      },

      setNotebooks: (notebooks: Notebook[]) => {
        set({
          notebooks,
          activeNotebookId: notebooks[0]?.id ?? null,
          activeSectionId: notebooks[0]?.sections[0]?.id ?? null,
        });
      },

      /** Adds an imported notebook, opens it immediately, and persists it. */
      addNotebook: (notebook: Notebook) => {
        const nextNotebooks = [notebook, ...get().notebooks.filter((nb) => nb.id !== notebook.id)];
        try {
          localStorage.setItem('notebook_last_opened_notebook', notebook.id);
        } catch (_) {}
        set({
          notebooks: nextNotebooks,
          activeNotebookId: notebook.id,
          activeSectionId: notebook.sections[0]?.id ?? null,
        });
        saveNotebookToDisk(notebook).catch(console.error);
      },

      hydrateFromDisk: async () => {
        try {
          const diskNotebooks = await loadNotebooksFromDisk();

          // Disk is the source of truth — use exactly what is on disk.
          // This ensures deleted notebooks (whose folders were removed) never reappear.
          const notebooksToLoad = diskNotebooks && diskNotebooks.length > 0 ? diskNotebooks : [];

          // Restore the last active notebook/section selection
          let nextActiveId = get().activeNotebookId;
          if (!nextActiveId && typeof localStorage !== 'undefined') {
            nextActiveId = localStorage.getItem('notebook_last_opened_notebook');
          }
          let activeNb = notebooksToLoad.find((n) => n.id === nextActiveId);

          if (!activeNb && notebooksToLoad.length > 0) {
            const sorted = [...notebooksToLoad].sort(
              (a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0)
            );
            activeNb = sorted[0];
            nextActiveId = activeNb?.id ?? null;
          } else if (!activeNb) {
            nextActiveId = null;
          }

          if (nextActiveId) {
            try {
              localStorage.setItem('notebook_last_opened_notebook', nextActiveId);
            } catch (_) {}
          }

          const activeSecId =
            activeNb && get().activeSectionId && activeNb.sections.some((s) => s.id === get().activeSectionId)
              ? get().activeSectionId
              : (activeNb?.sections[0]?.id ?? null);

          set({
            notebooks: notebooksToLoad,
            activeNotebookId: nextActiveId,
            activeSectionId: activeSecId,
          });
        } catch (err) {
          console.warn('[STORAGE] hydrateFromDisk failed:', err);
        }
      },
    }),
    {
      name: 'notebook-v1',
      version: SCHEMA_VERSION,
      partialize: (s) => ({
        notebooks: s.notebooks,
        activeNotebookId: s.activeNotebookId,
        activeSectionId: s.activeSectionId,
      }),
      migrate: (persisted, version) => {
        if (version < 1) {
          return { notebooks: [], activeNotebookId: null, activeSectionId: null };
        }
        return persisted as never;
      },
      onRehydrateStorage: () => (state, error) => {
        if (error) {
          console.error('[STORAGE] Persist rehydration error:', error);
          return;
        }

        // Auto hydrate from Documents/Notebook if local state is missing or empty
        setTimeout(() => {
          useNotesStore.getState().hydrateFromDisk().catch(console.error);
        }, 50);

        if (state) {
          // Ensure active notebook is restored on startup
          let targetId = state.activeNotebookId;
          if (!targetId && typeof localStorage !== 'undefined') {
            targetId = localStorage.getItem('notebook_last_opened_notebook');
          }
          let currentNb = state.notebooks.find((nb) => nb.id === targetId);
          if (!currentNb && state.notebooks.length > 0) {
            const sorted = [...state.notebooks].sort(
              (a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0)
            );
            currentNb = sorted[0];
            state.activeNotebookId = currentNb.id;
            state.activeSectionId = currentNb.sections[0]?.id ?? null;
          } else if (currentNb) {
            state.activeNotebookId = currentNb.id;
            const hasSec = currentNb.sections.some((s) => s.id === state.activeSectionId);
            if (!hasSec && currentNb.sections.length > 0) {
              state.activeSectionId = currentNb.sections[0].id;
            }
          }
        }
      },
    }
  )
);

// Auto-save debounced subscriber to persist all changes to ~/Documents/Notebook/notebooks.json
let autoSaveTimer: ReturnType<typeof setTimeout> | null = null;
let lastSavedNotebooks: Notebook[] | null = null;
useNotesStore.subscribe((state) => {
  if (state.notebooks === lastSavedNotebooks) return;
  lastSavedNotebooks = state.notebooks;
  if (autoSaveTimer) clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(() => {
    saveNotebooksToDisk(state.notebooks).catch((err) => {
      console.warn('[STORAGE] Failed to auto-save to Documents:', err);
    });
  }, 350);
});

// Selector helpers
export const useActiveNotebook = () =>
  useNotesStore((state) =>
    state.notebooks.find((nb) => nb.id === state.activeNotebookId)
  );

export const useActiveSection = () =>
  useNotesStore((state) => {
    const activeNb = state.notebooks.find((nb) => nb.id === state.activeNotebookId);
    return activeNb?.sections.find((sec) => sec.id === state.activeSectionId);
  });

