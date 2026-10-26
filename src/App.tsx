import { useRef, useEffect, useState, useCallback, type ChangeEvent } from 'react';
import { useNotesStore } from './store/useNotesStore';
import { useUiStore } from './store/useUiStore';
import { collectGarbage, putPageImage } from './store/imageStore';
import { initDocumentsStorage, saveNotebooksToDisk } from './services/storageService';
import { StartScreen } from './components/Screens/StartScreen';
import { CreateNotebookDialog } from './components/Screens/CreateNotebookDialog';
import { PdfExportDialog } from './components/Screens/PdfExportDialog';
import { Sidebar } from './components/Layout/Sidebar';
import { Canvas } from './components/Canvas/Canvas';
import { FloatingToolbar } from './components/Layout/FloatingToolbar';
import { CanvasElements } from './components/Canvas/CanvasElements';
import { processPdfFile } from './utils/pdfProcessor';
import { getDocumentExtension, processDocxFile, processPptxFile } from './utils/documentProcessor';
import { insertElementsAt, isCopiedPlainText } from './utils/elementActions';
import { CanvasElement, ImageElement, TextElement } from './types';
import { CommandPalette } from './components/CommandPalette/CommandPalette';
import { AiSidebar } from './components/AiSidebar/AiSidebar';
import { useAiStore } from './store/aiStore';

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
  const [isPdfDialogOpen, setIsPdfDialogOpen] = useState(false);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
    window.addEventListener('notebook-toast', onToast);
    return () => window.removeEventListener('notebook-toast', onToast);
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
    window.addEventListener('notebook-open-command-palette', handleOpenCommandPalette);

    return () => {
      window.removeEventListener('keydown', handleGlobalKeyDown, true);
      window.removeEventListener('notebook-open-command-palette', handleOpenCommandPalette);
    };
  }, []);

  // Suppress the WebView's native right-click menu (Reload / Inspect Element)
  // everywhere except plain text inputs, where the native text menu is useful.
  useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea')) return;
      e.preventDefault();
    };
    document.addEventListener('contextmenu', handleContextMenu);
    return () => document.removeEventListener('contextmenu', handleContextMenu);
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
            const lastSavedId = localStorage.getItem('notebook_last_opened_notebook');
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
          // AI-capture screenshots referenced by AI threads stay alive too.
          for (const thread of useAiStore.getState().threads) {
            if (thread.imageKey) liveKeys.add(thread.imageKey);
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

    const { textDefaults } = useUiStore.getState();
    const newTextElement: TextElement = {
      id: crypto.randomUUID(),
      type: 'text',
      x: canvasX,
      y: canvasY,
      width: 320,
      height: null,
      content: '<p></p>',
      fontFamily: textDefaults.fontFamily,
      fontSize: textDefaults.fontSize,
      color: textDefaults.color || undefined,
      isBold: textDefaults.isBold,
      zIndex: 1000,
    };

    addElement(newTextElement);
    setSelectedId(newTextElement.id);
    setEditingId(newTextElement.id);
  };

  // Trigger the shared import file picker (documents + images)
  const handleImportClick = () => {
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
      fileInputRef.current.click();
    }
  };

  /** Stores an image in IndexedDB and builds a canvas element centred on (x, y). */
  const buildImageElement = async (
    file: File,
    options: { x: number; y: number; index?: number; maxWidth?: number }
  ): Promise<ImageElement> => {
    const { x, y, index = 0, maxWidth = 480 } = options;

    const imageKey = `img:${crypto.randomUUID()}`;
    await putPageImage(imageKey, file);

    // Measure natural dimensions
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.src = objectUrl;
    try {
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error(`Could not decode ${file.name}`));
      });
    } finally {
      URL.revokeObjectURL(objectUrl);
    }

    const naturalWidth = img.naturalWidth || 400;
    const naturalHeight = img.naturalHeight || 300;
    const baseWidth = Math.min(maxWidth, naturalWidth);
    const baseHeight = Math.round(baseWidth * (naturalHeight / naturalWidth));

    // Stagger multiple files slightly
    const offset = index * 24;

    return {
      id: crypto.randomUUID(),
      type: 'image',
      name: file.name,
      x: Math.round(x - baseWidth / 2 + offset),
      y: Math.round(y - baseHeight / 2 + offset),
      width: baseWidth,
      height: baseHeight,
      imageKey,
      isLocked: false,
      zIndex: 100 + index,
    };
  };

  // Places one or more image files at the centre of the visible canvas
  const addImagesToCanvas = async (files: File[]) => {
    if (!activeSection || files.length === 0) return;

    const container = document.getElementById('infinite-canvas-container');
    const rect = container?.getBoundingClientRect() ?? {
      width: window.innerWidth - 280,
      height: window.innerHeight,
    };

    const canvasCenterX = (rect.width / 2 - activeSection.viewport.x) / activeSection.viewport.zoom;
    const canvasCenterY = (rect.height / 2 - activeSection.viewport.y) / activeSection.viewport.zoom;

    const elements: ImageElement[] = [];
    for (let i = 0; i < files.length; i++) {
      try {
        elements.push(await buildImageElement(files[i], { x: canvasCenterX, y: canvasCenterY, index: i }));
      } catch (err) {
        console.error('Failed to load image attachment:', err);
        showToast(`Could not load image: ${files[i].name}`);
      }
    }

    // Batch add — single store update + single undo snapshot
    if (elements.length > 0) addElements(elements);
  };

  // Process one document file (PDF, DOCX or PPTX)
  const importDocumentFile = async (file: File) => {
    const extension = getDocumentExtension(file.name);
    if (extension === 'doc' || extension === 'ppt') {
      showToast(`Legacy .${extension} files aren't supported. Save as .${extension}x or PDF first.`);
      return;
    }
    if (extension !== 'pdf' && extension !== 'docx' && extension !== 'pptx') {
      showToast('Unsupported file type. Choose a PDF, DOCX or PPTX file.');
      return;
    }

    setIsImporting(true);
    setImportProgress({ done: 0, total: 1 });

    try {
      const container = document.getElementById('infinite-canvas-container');
      const rect = container?.getBoundingClientRect() ?? {
        width: window.innerWidth - 280,
        height: window.innerHeight,
      };

      const geometry = {
        viewport: activeSection!.viewport,
        containerRect: { width: rect.width, height: rect.height },
      };
      const onProgress = (done: number, total: number) => {
        setImportProgress({ done, total });
      };

      let pages;
      if (extension === 'docx') {
        pages = await processDocxFile(file, geometry.viewport, geometry.containerRect, onProgress);
      } else if (extension === 'pptx') {
        pages = await processPptxFile(file, geometry.viewport, geometry.containerRect, onProgress);
      } else {
        pages = await processPdfFile(file, geometry.viewport, geometry.containerRect, onProgress);
      }

      // Batch add — single store update + single undo snapshot
      addElements(pages);
    } catch (err) {
      console.error('Failed to import document:', err);
      const label = extension === 'pptx' ? 'PowerPoint' : extension === 'docx' ? 'Word' : 'PDF';
      showToast(`Could not import ${label} file. Please check the file format.`);
    } finally {
      setIsImporting(false);
      setImportProgress(null);
    }
  };

  // Single entry point for the Import button: routes documents and images
  const handleImportFiles = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (files.length === 0 || !activeSection) return;

    const images = files.filter((file) => file.type.startsWith('image/'));
    const documents = files.filter((file) => !file.type.startsWith('image/'));

    if (images.length > 0) await addImagesToCanvas(images);
    for (const file of documents) await importDocumentFile(file);
  };

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
      if (
        pastedText &&
        pastedText.trim() &&
        !pastedText.startsWith('[Notebook Elements') &&
        !isCopiedPlainText(pastedText)
      ) {
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

        const { textDefaults } = useUiStore.getState();
        const newTextElement: TextElement = {
          id: crypto.randomUUID(),
          type: 'text',
          x: Math.round(canvasCenterX - 170),
          y: Math.round(canvasCenterY - 30),
          width: 340,
          height: null,
          content: paragraphs || '<p></p>',
          fontFamily: textDefaults.fontFamily,
          fontSize: textDefaults.fontSize,
          color: textDefaults.color || undefined,
          isBold: textDefaults.isBold,
          zIndex: 1000,
        };

        addElement(newTextElement);
        setSelectedId(newTextElement.id);
        showToast('Pasted text note');
        return;
      }

      // 4. Fallback to the in-app clipboard snapshot. Some WebView / clipboard
      // manager combinations only keep our "[Notebook Elements …]" marker and
      // drop the custom MIME payload; paste the most recent in-app copy instead.
      if (pastedText && (pastedText.startsWith('[Notebook Elements') || isCopiedPlainText(pastedText))) {
        const fallback = useUiStore.getState().clipboardElements;
        if (fallback && fallback.length > 0) {
          e.preventDefault();
          const container = document.getElementById('infinite-canvas-container');
          const rect = container?.getBoundingClientRect() ?? {
            width: window.innerWidth - 280,
            height: window.innerHeight,
          };
          const canvasCenterX = (rect.width / 2 - activeSection.viewport.x) / activeSection.viewport.zoom;
          const canvasCenterY = (rect.height / 2 - activeSection.viewport.y) / activeSection.viewport.zoom;
          insertElementsAt(fallback, canvasCenterX, canvasCenterY);
        }
      }
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [activeNotebookId, activeSection, addElement, addElements, setSelectedId, setSelectedIds]);

  // Export current section to PDF
  const handleExportPdfClick = () => {
    if (!activeNotebook || !activeSection) return;
    if (activeSection.elements.length === 0) {
      showToast('Nothing to export — add a note or import a page first.');
      return;
    }
    // Leaving the editor flushes TipTap's buffered keystrokes into the store,
    // so the PDF always contains the very last character that was typed.
    setEditingId(null);
    setIsPdfDialogOpen(true);
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

          {/* Hidden import input — documents and images */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.doc,.docx,.ppt,.pptx,image/*,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.presentationml.presentation"
            multiple
            onChange={handleImportFiles}
            className="hidden"
          />

          {/* Sidebar */}
          <Sidebar
            onNewNotebookClick={() => setIsCreateModalOpen(true)}
            onGoToStartScreen={() => setActiveNotebook(null)}
          />

          {/* Canvas Area (floating toolbar is centered over this region) */}
          <main className="flex-1 h-full relative overflow-hidden">
            {/* Floating Toolbar centered over canvas */}
            <FloatingToolbar
              onAddDocumentClick={handleImportClick}
              onExportPdfClick={handleExportPdfClick}
              onAiClick={() => {
                const ui = useUiStore.getState();
                ui.setAiSidebarOpen(!ui.isAiSidebarOpen);
              }}
            />

            {/* Async Import Progress Pill — Dynamic Island style */}
            {isImporting && importProgress && (
              <div className="absolute top-20 left-1/2 -translate-x-1/2 z-50 px-5 py-2.5 rounded-full bg-gray-900/90 dark:bg-[#1E1E1E]/95 text-white dark:text-gray-100 text-xs font-medium backdrop-blur-xl shadow-2xl border border-white/10 pointer-events-none flex items-center gap-3 animate-slide-down">
                <span className="w-2 h-2 rounded-full bg-white animate-ping shrink-0" />
                <span>
                  {importProgress.done > 0
                    ? `Importing page ${importProgress.done} of ${importProgress.total}…`
                    : 'Importing document…'}
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

          {/* Export section as PDF */}
          {activeSection && (
            <PdfExportDialog
              isOpen={isPdfDialogOpen}
              onClose={() => setIsPdfDialogOpen(false)}
              elements={activeSection.elements}
              notebookName={activeNotebook.name}
              sectionName={activeSection.name}
              onExported={(pages) =>
                showToast(`Exported ${pages} page${pages === 1 ? '' : 's'} to PDF`)
              }
            />
          )}

          {/* Floating AI sidebar (right) — panel or minimized circular icon */}
          <AiSidebar />
        </div>
      )}
    </>
  );
}

