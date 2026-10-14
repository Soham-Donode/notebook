import { useRef, useEffect, useState, useCallback, type ChangeEvent } from 'react';
import { useNotesStore } from './store/useNotesStore';
import { useUiStore } from './store/useUiStore';
import { collectGarbage, putPageImage } from './store/imageStore';
import { initDocumentsStorage, saveNotebooksToDisk } from './services/storageService';
import { StartScreen } from './components/Screens/StartScreen';
import { CreateNotebookDialog } from './components/Screens/CreateNotebookDialog';
import { Sidebar } from './components/Layout/Sidebar';
import { Canvas } from './components/Canvas/Canvas';
import { FloatingToolbar } from './components/Layout/FloatingToolbar';
import { CanvasElements } from './components/Canvas/CanvasElements';
import { processPdfFile } from './utils/pdfProcessor';
import { processPptFile } from './utils/pptProcessor';
import { exportSectionToPdf } from './utils/exportPdf';
import { CanvasElement, ImageElement, TextElement } from './types';
import { CommandPalette } from './components/CommandPalette/CommandPalette';

export default function App() {
  const activeNotebookId = useNotesStore((state) => state.activeNotebookId);
  const activeSectionId = useNotesStore((state) => state.activeSectionId);
  const notebooks = useNotesStore((state) => state.notebooks);

  const activeNotebook = notebooks.find((nb) => nb.id === activeNotebookId);
  const activeSection = activeNotebook?.sections.find((s) => s.id === activeSectionId);

  const addElement = useNotesStore((state) => state.addElement);
  const addElements = useNotesStore((state) => state.addElements);
  const createNotebook = useNotesStore((state) => state.createNotebook);
  const setActiveNotebook = useNotesStore((state) => state.setActiveNotebook);

  const setEditingId = useUiStore((state) => state.setEditingId);
  const setSelectedId = useUiStore((state) => state.setSelectedId);
  const setSelectedIds = useUiStore((state) => state.setSelectedIds);
  const isImporting = useUiStore((state) => state.isImporting);
  const importProgress = useUiStore((state) => state.importProgress);
  const setIsImporting = useUiStore((state) => state.setIsImporting);
  const setImportProgress = useUiStore((state) => state.setImportProgress);

  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const pptInputRef = useRef<HTMLInputElement>(null);

  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = useCallback((msg: string) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToastMessage(msg);
    toastTimerRef.current = setTimeout(() => setToastMessage(null), 4000);
  }, []);

  const showToastRef = useRef(showToast);
  showToastRef.current = showToast;

  useEffect(() => {
    const onToast = (e: Event) => {
      const customEv = e as CustomEvent<string>;
      if (customEv.detail) {
        showToastRef.current(customEv.detail);
      }
    };
    window.addEventListener('inkwell-toast', onToast);
    return () => window.removeEventListener('inkwell-toast', onToast);
  }, []);

  // Esc → back to All Notebooks, but only when nothing else needs the key
  // (capture phase so we read the state before Canvas clears selection on the same press)
  useEffect(() => {
    const onEscape = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const notes = useNotesStore.getState();
      if (!notes.activeNotebookId) return;

      const t = e.target as HTMLElement | null;
      const typing =
        t?.tagName === 'INPUT' ||
        t?.tagName === 'TEXTAREA' ||
        t?.tagName === 'SELECT' ||
        t?.isContentEditable ||
        Boolean(t?.closest('.ProseMirror'));
      if (typing) return;

      const ui = useUiStore.getState();
      if (ui.editingId || ui.selectedId || ui.selectedIds.length > 0 || ui.activeTool !== 'select') return;
      // Any open modal (confirm, create, command palette) owns Esc
      if (document.querySelector('.fixed.inset-0')) return;

      notes.setActiveNotebook(null);
    };
    window.addEventListener('keydown', onEscape, true);
    return () => window.removeEventListener('keydown', onEscape, true);
  }, []);

  // Global shortcuts: Command + K (Search), Ctrl + B (Sidebar), Cmd+← (Home)
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K' || e.code === 'KeyK')) {
        e.preventDefault();
        setIsCommandPaletteOpen((prev) => !prev);
        return;
      }

      // Cmd+J → go back to start screen (skip only if editing a text element)
      if ((e.metaKey || e.ctrlKey) && (e.key === 'j' || e.key === 'J' || e.code === 'KeyJ')) {
        const isEditing = !!useUiStore.getState().editingId;
        if (!isEditing) {
          e.preventDefault();
          e.stopPropagation();
          useNotesStore.getState().setActiveNotebook(null);
          return;
        }
      }

      const isB = e.key === 'b' || e.key === 'B' || e.code === 'KeyB';
      if (isB) {
        const target = e.target as HTMLElement | null;
        const isInput =
          target?.tagName === 'INPUT' ||
          target?.tagName === 'TEXTAREA' ||
          target?.isContentEditable ||
          Boolean(target?.closest('.ProseMirror'));

        if (e.ctrlKey || (!isInput && e.metaKey)) {
          e.preventDefault();
          useUiStore.getState().toggleSidebar();
        }
      }
    };

    const handleOpenCommandPalette = () => {
      setIsCommandPaletteOpen(true);
    };

    window.addEventListener('keydown', handleGlobalKeyDown, true);
    window.addEventListener('inkwell-open-command-palette', handleOpenCommandPalette);

    return () => {
      window.removeEventListener('keydown', handleGlobalKeyDown, true);
      window.removeEventListener('inkwell-open-command-palette', handleOpenCommandPalette);
    };
  }, []);

  // Initialize permanent ~/Documents/Notebook filesystem storage and hydrate notebooks
  useEffect(() => {
    initDocumentsStorage()
      .then(async () => {
        await useNotesStore.getState().hydrateFromDisk();
        const state = useNotesStore.getState();
        const nbs = state.notebooks;
        if (nbs && nbs.length > 0) {
          // Guarantee the app opens directly with the last active or recent notebook, never the home screen
          if (!state.activeNotebookId || !nbs.some((n) => n.id === state.activeNotebookId)) {
            const lastSavedId = localStorage.getItem('inkwell_last_opened_notebook');
            const found = nbs.find((n) => n.id === lastSavedId);
            const target = found || [...nbs].sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0))[0];
            if (target) {
              state.setActiveNotebook(target.id);
            }
          }

          // Persist notebooks to ~/Documents/Notebook
          await saveNotebooksToDisk(nbs);
          const liveKeys = new Set<string>();
          for (const nb of nbs) {
            for (const sec of nb.sections) {
              for (const el of sec.elements) {
                if ((el.type === 'pdf-page' || el.type === 'image') && el.imageKey) {
                  liveKeys.add(el.imageKey);
                }
              }
            }
          }
          collectGarbage(liveKeys).catch(console.error);
        }
      })
      .catch((err) => console.error('Error initializing Documents storage:', err));
  }, []);

  // Ensure any in-progress note editing and state is safely flushed to disk on quit/unload
  useEffect(() => {
    const handleBeforeUnload = () => {
      const { editingId, setEditingId } = useUiStore.getState();
      if (editingId) {
        setEditingId(null);
      }
      saveNotebooksToDisk(useNotesStore.getState().notebooks).catch(console.error);
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  // Double click empty canvas creates new TextElement at canvas position (§8.1, §9.1)
  const handleDoubleClickCanvas = (canvasX: number, canvasY: number) => {
    if (!activeNotebookId || !activeSectionId) return;

    const ui = useUiStore.getState();
    const newTextElement: TextElement = {
      id: crypto.randomUUID(),
      type: 'text',
      x: canvasX,
      y: canvasY,
      width: 320,
      height: null,
      content: '<p></p>',
      fontFamily: ui.defaultFontFamily,
      fontSize: ui.defaultFontSize,
      ...(ui.defaultColor ? { color: ui.defaultColor } : {}),
      zIndex: 1000,
    };

    addElement(newTextElement);
    setSelectedId(newTextElement.id);
    setEditingId(newTextElement.id);
  };

  // Trigger PDF file picker
  const handleAddPdfClick = () => {
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
      fileInputRef.current.click();
    }
  };

  // Trigger Image attachment file picker
  const handleAddImageClick = () => {
    if (imageInputRef.current) {
      imageInputRef.current.value = '';
      imageInputRef.current.click();
    }
  };

  // Trigger PowerPoint file picker
  const handleAddPptClick = () => {
    if (pptInputRef.current) {
      pptInputRef.current.value = '';
      pptInputRef.current.click();
    }
  };

  const classifyFile = (file: File): 'pdf' | 'ppt' | 'image' | null => {
    const name = file.name.toLowerCase();
    if (file.type === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
    if (name.endsWith('.pptx') || name.endsWith('.ppt')) return 'ppt';
    if (file.type.startsWith('image/')) return 'image';
    return null;
  };

  // Import any mix of PDFs, presentations and images, laid out side by side
  const importFiles = async (incoming: File[]) => {
    if (!activeSection || useUiStore.getState().isImporting) return;

    const files = incoming.filter((f) => classifyFile(f));
    const skipped = incoming.length - files.length;
    if (files.length === 0) {
      showToast('Unsupported file type. Drop PDFs, PowerPoints or images.');
      return;
    }

    const container = document.getElementById('infinite-canvas-container');
    const rect = container?.getBoundingClientRect() ?? {
      width: window.innerWidth - 280,
      height: window.innerHeight,
    };
    const size = { width: rect.width, height: rect.height };
    const base = activeSection.viewport;
    let offsetX = 0; // canvas-space shift applied to each successive file

    setIsImporting(true);
    setImportProgress({ done: 0, total: 1 });

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const kind = classifyFile(file)!;
        // Moving the viewport left moves the placement centre right
        const vp = { ...base, x: base.x - offsetX * base.zoom };
        try {
          let added: { x: number; width: number }[] = [];
          if (kind === 'image') {
            const el = await buildImageElement(file, vp, size, i);
            addElement(el);
            added = [el];
          } else {
            const onProgress = (done: number, total: number) => setImportProgress({ done, total });
            const pages =
              kind === 'pdf'
                ? await processPdfFile(file, vp, size, onProgress)
                : await processPptFile(file, vp, size, onProgress);
            addElements(pages);
            added = pages;
            if (kind === 'ppt') {
              showToast(`Imported ${pages.length} slide${pages.length !== 1 ? 's' : ''} from ${file.name}`);
            }
          }
          const maxW = added.reduce((m, el) => Math.max(m, el.width), 0);
          offsetX += maxW + 60;
        } catch (err) {
          console.error(`Failed to import ${file.name}:`, err);
          showToast(
            kind === 'ppt'
              ? 'Could not convert presentation. PowerPoint or LibreOffice must be installed.'
              : `Could not import ${file.name}`
          );
        }
      }
      if (skipped > 0) showToast(`Skipped ${skipped} unsupported file${skipped !== 1 ? 's' : ''}`);
    } finally {
      setIsImporting(false);
      setImportProgress(null);
    }
  };

  const buildImageElement = async (
    file: File,
    viewport: { x: number; y: number; zoom: number },
    size: { width: number; height: number },
    index: number
  ): Promise<ImageElement> => {
    const canvasCenterX = (size.width / 2 - viewport.x) / viewport.zoom;
    const canvasCenterY = (size.height / 2 - viewport.y) / viewport.zoom;

    const imageKey = `img:${crypto.randomUUID()}`;
    await putPageImage(imageKey, file);

    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.src = objectUrl;
    try {
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = reject;
      });
    } finally {
      URL.revokeObjectURL(objectUrl);
    }

    const naturalWidth = img.naturalWidth || 400;
    const naturalHeight = img.naturalHeight || 300;
    const baseWidth = Math.min(480, naturalWidth);
    const baseHeight = Math.round(baseWidth * (naturalHeight / naturalWidth));

    return {
      id: crypto.randomUUID(),
      type: 'image',
      name: file.name,
      x: Math.round(canvasCenterX - baseWidth / 2),
      y: Math.round(canvasCenterY - baseHeight / 2),
      width: baseWidth,
      height: baseHeight,
      imageKey,
      isLocked: false,
      zIndex: 100 + index,
    };
  };

  const handleFileInputChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (files.length) await importFiles(files);
  };

  // Drag & drop files onto the canvas area
  const [isDragOver, setIsDragOver] = useState(false);
  const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes('Files');

  // Global Clipboard Paste Handler (Priority 1: Screenshot/Image, Priority 2: Canvas Elements, Priority 3: Plain text)
  useEffect(() => {
    const handlePaste = async (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      const activeEl = document.activeElement as HTMLElement | null;
      const isInput =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.isContentEditable ||
        Boolean(target?.closest('.ProseMirror')) ||
        activeEl?.tagName === 'INPUT' ||
        activeEl?.tagName === 'TEXTAREA' ||
        activeEl?.isContentEditable ||
        Boolean(activeEl?.closest('.ProseMirror'));

      // If user is actively typing inside an input or text editor, let standard paste proceed
      if (isInput) return;
      if (!activeNotebookId || !activeSection) return;

      const clipboardData = e.clipboardData;
      if (!clipboardData) return;

      // 1. Check for image files in clipboard (e.g. screenshots taken via Cmd+Shift+4)
      let imageFile: File | null = null;
      const items = clipboardData.items;

      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith('image/')) {
          imageFile = items[i].getAsFile();
          break;
        }
      }

      if (!imageFile && clipboardData.files.length > 0) {
        for (let i = 0; i < clipboardData.files.length; i++) {
          if (clipboardData.files[i].type.startsWith('image/')) {
            imageFile = clipboardData.files[i];
            break;
          }
        }
      }

      if (imageFile) {
        e.preventDefault();
        const container = document.getElementById('infinite-canvas-container');
        const rect = container?.getBoundingClientRect() ?? {
          width: window.innerWidth - 280,
          height: window.innerHeight,
        };

        const canvasCenterX = (rect.width / 2 - activeSection.viewport.x) / activeSection.viewport.zoom;
        const canvasCenterY = (rect.height / 2 - activeSection.viewport.y) / activeSection.viewport.zoom;

        try {
          const imageKey = `img:${crypto.randomUUID()}`;
          await putPageImage(imageKey, imageFile);

          const img = new Image();
          const objectUrl = URL.createObjectURL(imageFile);
          img.src = objectUrl;
          await new Promise<void>((resolve, reject) => {
            img.onload = () => resolve();
            img.onerror = reject;
          });
          URL.revokeObjectURL(objectUrl);

          const naturalWidth = img.naturalWidth || 400;
          const naturalHeight = img.naturalHeight || 300;
          const baseWidth = Math.min(500, naturalWidth);
          const baseHeight = Math.round(baseWidth * (naturalHeight / naturalWidth));

          const newImageElement: ImageElement = {
            id: crypto.randomUUID(),
            type: 'image',
            name: `Pasted Image ${new Date().toLocaleTimeString()}`,
            x: Math.round(canvasCenterX - baseWidth / 2),
            y: Math.round(canvasCenterY - baseHeight / 2),
            width: baseWidth,
            height: baseHeight,
            imageKey,
            isLocked: false,
            zIndex: 100,
          };

          addElement(newImageElement);
          setSelectedId(newImageElement.id);
          showToast('Pasted image from clipboard');
        } catch (err) {
          console.error('Failed to paste image from clipboard:', err);
          showToast('Could not paste image');
        }
        return;
      }

      // 2. Check for copied in-app canvas elements
      const rawElements = clipboardData.getData('application/x-notebook-elements');
      if (rawElements) {
        try {
          const parsed = JSON.parse(rawElements) as CanvasElement[];
          if (Array.isArray(parsed) && parsed.length > 0) {
            e.preventDefault();

            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            for (const el of parsed) {
              if (el.type === 'arrow') {
                minX = Math.min(minX, el.startX, el.endX);
                minY = Math.min(minY, el.startY, el.endY);
                maxX = Math.max(maxX, el.startX, el.endX);
                maxY = Math.max(maxY, el.startY, el.endY);
              } else {
                minX = Math.min(minX, el.x);
                minY = Math.min(minY, el.y);
                maxX = Math.max(maxX, el.x + (el.width || 0));
                maxY = Math.max(maxY, el.y + (el.height || 0));
              }
            }
            const groupCenterX = (minX + maxX) / 2;
            const groupCenterY = (minY + maxY) / 2;

            const container = document.getElementById('infinite-canvas-container');
            const rect = container?.getBoundingClientRect() ?? {
              width: window.innerWidth - 280,
              height: window.innerHeight,
            };
            const canvasCenterX = (rect.width / 2 - activeSection.viewport.x) / activeSection.viewport.zoom;
            const canvasCenterY = (rect.height / 2 - activeSection.viewport.y) / activeSection.viewport.zoom;

            let dx = 32;
            let dy = 32;
            const dist = Math.hypot(canvasCenterX - groupCenterX, canvasCenterY - groupCenterY);
            if (dist > 350) {
              dx = Math.round(canvasCenterX - groupCenterX);
              dy = Math.round(canvasCenterY - groupCenterY);
            }

            const maxZ = activeSection.elements.reduce((m, el) => Math.max(m, el.zIndex), 100);

            const newElements: CanvasElement[] = parsed.map((el, idx) => {
              const newId = crypto.randomUUID();
              const newZ = maxZ + 1 + idx;
              if (el.type === 'arrow') {
                return {
                  ...el,
                  id: newId,
                  startX: el.startX + dx,
                  startY: el.startY + dy,
                  endX: el.endX + dx,
                  endY: el.endY + dy,
                  x: el.x + dx,
                  y: el.y + dy,
                  zIndex: newZ,
                };
              }
              return {
                ...el,
                id: newId,
                x: el.x + dx,
                y: el.y + dy,
                zIndex: newZ,
              };
            });

            addElements(newElements);
            if (newElements.length === 1) {
              setSelectedId(newElements[0].id);
            } else {
              setSelectedIds(newElements.map((item) => item.id));
            }
            showToast(`Pasted ${newElements.length} item${newElements.length > 1 ? 's' : ''}`);
            return;
          }
        } catch (err) {
          console.warn('Failed to parse application/x-notebook-elements:', err);
        }
      }

      // 3. Check for plain text in clipboard (from other apps or browsers)
      const pastedText = clipboardData.getData('text/plain');
      if (pastedText && pastedText.trim() && !pastedText.startsWith('[Notebook Elements')) {
        e.preventDefault();
        const container = document.getElementById('infinite-canvas-container');
        const rect = container?.getBoundingClientRect() ?? {
          width: window.innerWidth - 280,
          height: window.innerHeight,
        };

        const canvasCenterX = (rect.width / 2 - activeSection.viewport.x) / activeSection.viewport.zoom;
        const canvasCenterY = (rect.height / 2 - activeSection.viewport.y) / activeSection.viewport.zoom;

        const paragraphs = pastedText
          .split('\n')
          .map((line) => `<p>${line || '<br>'}</p>`)
          .join('');

        const newTextElement: TextElement = {
          id: crypto.randomUUID(),
          type: 'text',
          x: Math.round(canvasCenterX - 170),
          y: Math.round(canvasCenterY - 30),
          width: 340,
          height: null,
          content: paragraphs || '<p></p>',
          fontFamily: useUiStore.getState().defaultFontFamily,
          fontSize: useUiStore.getState().defaultFontSize,
          zIndex: 1000,
        };

        addElement(newTextElement);
        setSelectedId(newTextElement.id);
        showToast('Pasted text note');
      }
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [activeNotebookId, activeSection, addElement, addElements, setSelectedId, setSelectedIds]);

  // Export current section to PDF
  const handleExportPdfClick = async () => {
    if (!activeNotebook || !activeSection) return;
    try {
      await exportSectionToPdf(
        activeSection.elements,
        activeNotebook.name,
        activeSection.name
      );
    } catch (err) {
      console.error('Failed to export PDF:', err);
      showToast('Export failed. Please try again.');
    }
  };

  return (
    <>
      {/* Global In-app Notification Toast */}
      {toastMessage && (
        <div className="fixed top-12 left-1/2 -translate-x-1/2 z-[9999] px-5 py-2.5 rounded-2xl bg-gray-900/90 dark:bg-[#1E1E1E]/95 text-white dark:text-gray-100 text-xs font-medium backdrop-blur-xl shadow-2xl border border-white/15 dark:border-white/10 pointer-events-none flex items-center gap-2 animate-slide-down">
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Global Command + K Search & Quick Switcher Palette */}
      <CommandPalette
        isOpen={isCommandPaletteOpen}
        onClose={() => setIsCommandPaletteOpen(false)}
        mode={activeNotebookId ? 'sections' : 'notebooks'}
      />

      {/* If no notebook is active, render StartScreen */}
      {!activeNotebookId || !activeNotebook ? (
        <StartScreen />
      ) : (
        <div className="w-full h-full flex flex-row bg-canvas select-none relative overflow-hidden">
          {/* Titlebar drag region for macOS Overlay */}
          <div className="fixed top-0 left-0 right-0 h-10 drag-region z-50 pointer-events-none" />

          {/* Hidden PDF file input */}
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf,.pdf"
            multiple
            onChange={handleFileInputChange}
            className="hidden"
          />

          {/* Hidden Image attachment input */}
          <input
            ref={imageInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={handleFileInputChange}
            className="hidden"
          />

          {/* Hidden PowerPoint input (.pptx) */}
          <input
            ref={pptInputRef}
            type="file"
            accept=".ppt,.pptx,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation"
            multiple
            onChange={handleFileInputChange}
            className="hidden"
          />

          {/* Sidebar */}
          <Sidebar
            onNewNotebookClick={() => setIsCreateModalOpen(true)}
            onGoToStartScreen={() => setActiveNotebook(null)}
          />

          {/* Canvas Area (floating toolbar is centered over this region) */}
          <main
            className="flex-1 h-full relative overflow-hidden"
            onDragEnter={(e) => { if (hasFiles(e)) { e.preventDefault(); setIsDragOver(true); } }}
            onDragOver={(e) => { if (hasFiles(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setIsDragOver(false);
            }}
            onDrop={(e) => {
              if (!hasFiles(e)) return;
              e.preventDefault();
              setIsDragOver(false);
              void importFiles(Array.from(e.dataTransfer.files));
            }}
          >
            {isDragOver && (
              <div className="absolute inset-3 z-[60] rounded-3xl border-2 border-dashed border-pill-active bg-black/5 backdrop-blur-[1px] pointer-events-none flex items-center justify-center text-lg text-gray-700 dark:text-gray-200">
                Drop PDFs, PowerPoints or images to add them
              </div>
            )}
            {/* Floating Toolbar centered over canvas */}
            <FloatingToolbar
              onAddPdfClick={handleAddPdfClick}
              onAddImageClick={handleAddImageClick}
              onAddPptClick={handleAddPptClick}
              onExportPdfClick={handleExportPdfClick}
            />

            {/* Async Import Progress Pill — Dynamic Island style */}
            {isImporting && importProgress && (
              <div className="absolute top-20 left-1/2 -translate-x-1/2 z-50 px-5 py-2.5 rounded-full bg-gray-900/90 dark:bg-[#1E1E1E]/95 text-white dark:text-gray-100 text-xs font-medium backdrop-blur-xl shadow-2xl border border-white/10 pointer-events-none flex items-center gap-3 animate-slide-down">
                <span className="w-2 h-2 rounded-full bg-white animate-ping shrink-0" />
                <span>
                  Importing {importProgress.done} of {importProgress.total}…
                </span>
              </div>
            )}

            {/* Infinite Canvas */}
            <Canvas onDoubleClickCanvas={handleDoubleClickCanvas}>
              <CanvasElements onDoubleClickCanvas={handleDoubleClickCanvas} />
            </Canvas>
          </main>

          {/* New Notebook Dialog when triggered from workspace sidebar */}
          <CreateNotebookDialog
            isOpen={isCreateModalOpen}
            onClose={() => setIsCreateModalOpen(false)}
            onCreate={(name) => createNotebook(name)}
          />
        </div>
      )}
    </>
  );
}

