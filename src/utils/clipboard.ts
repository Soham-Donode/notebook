import { isTauri } from '@tauri-apps/api/core';
import { readImage, readText as readNativeText } from '@tauri-apps/plugin-clipboard-manager';
import { CanvasElement, ImageElement, TextElement } from '../types';
import { useNotesStore } from '../store/useNotesStore';
import { useUiStore } from '../store/useUiStore';
import { putPageImage } from '../store/imageStore';
import {
  getElementBounds,
  insertElementsAt,
  insertElementsNear,
  isCopiedPlainText,
  pasteClipboardAt,
  pasteClipboardNear,
} from './elementActions';

const PASTE_GAP = 24;
const RESPONSE_PLACEHOLDER = '[Notebook Elements';

type ClipboardPayload =
  | { kind: 'image'; image: Blob }
  | { kind: 'elements'; elements: CanvasElement[] }
  | { kind: 'text'; text: string }
  /** The clipboard holds our own "[Notebook Elements …]" marker. */
  | { kind: 'placeholder' }
  /** The clipboard is empty. */
  | { kind: 'empty' }
  /** The clipboard could not be read (permissions, unsupported WebView, …). */
  | { kind: 'unreadable' };

interface PastePlacement {
  /** Paste next to this element (used by element action bars / context menus). */
  anchor?: CanvasElement;
  /** Paste at this canvas-space point (used by empty-canvas context menu). */
  point?: { x: number; y: number };
}

function showToast(message: string) {
  window.dispatchEvent(new CustomEvent('notebook-toast', { detail: message }));
}

function parseElements(raw: string): CanvasElement[] | null {
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed as CanvasElement[];
    }
  } catch {
    // Not JSON — ignore.
  }
  return null;
}

function isNotebookPlaceholder(text: string): boolean {
  return text.startsWith(RESPONSE_PLACEHOLDER);
}

/**
 * Classifies clipboard text as either external text or our own copy.
 *
 * A copied text note is written to the system clipboard as its real text, so
 * checking the marker alone is not enough — compare it with the plain text we
 * last wrote in-app.
 */
function classifyText(text: string): ClipboardPayload {
  if (isNotebookPlaceholder(text) || isCopiedPlainText(text)) {
    return { kind: 'placeholder' };
  }
  return { kind: 'text', text };
}

/**
 * Reads an image straight from the OS clipboard through Tauri.
 *
 * WKWebView does not reliably expose images via `navigator.clipboard.read()`
 * (it often rejects with NotAllowedError), so the native plugin is the only
 * dependable way to know what was copied most recently.
 */
async function readNativeImage(): Promise<Blob | null> {
  if (!isTauri()) return null;

  try {
    const image = await readImage();
    try {
      const { width, height } = await image.size();
      if (!width || !height) return null;

      const rgba = await image.rgba();
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext('2d');
      if (!ctx) return null;

      ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);
      return await new Promise<Blob | null>((resolve) => {
        canvas.toBlob(resolve, 'image/png');
      });
    } finally {
      await image.close();
    }
  } catch {
    // No image on the clipboard (or the plugin is unavailable).
    return null;
  }
}

/** Reads plain text through Tauri when possible, then the browser API. */
async function readTextFromClipboard(): Promise<string | null> {
  if (isTauri()) {
    try {
      return await readNativeText();
    } catch {
      // Fall through to the browser API.
    }
  }

  try {
    return await navigator.clipboard.readText();
  } catch {
    return null;
  }
}

/**
 * Reads the current macOS clipboard. Images take priority over copied canvas
 * elements, then plain text — the same precedence as the Cmd+V handler.
 */
async function readSystemClipboard(): Promise<ClipboardPayload> {
  // 1. Native image read (most reliable inside WKWebView).
  const nativeImage = await readNativeImage();
  if (nativeImage) return { kind: 'image', image: nativeImage };

  // 2. Async Clipboard API: custom MIME types, images and text.
  const clipboard = navigator.clipboard;
  if (clipboard && typeof clipboard.read === 'function') {
    try {
      const items = await clipboard.read();

      for (const item of items) {
        for (const type of item.types) {
          if (type.startsWith('image/')) {
            const blob = await item.getType(type);
            if (blob && blob.size > 0) return { kind: 'image', image: blob };
          }
        }
      }

      for (const item of items) {
        if (item.types.includes('application/x-notebook-elements')) {
          const raw = await (await item.getType('application/x-notebook-elements')).text();
          const elements = parseElements(raw);
          if (elements) return { kind: 'elements', elements };
        }
      }

      for (const item of items) {
        if (item.types.includes('text/plain')) {
          const text = await (await item.getType('text/plain')).text();
          if (!text.trim()) continue;
          return classifyText(text);
        }
      }

      return { kind: 'empty' };
    } catch {
      // Permission denied / unsupported — fall back to text reading below.
    }
  }

  // 3. Plain text fallback.
  const text = await readTextFromClipboard();
  if (text === null) return { kind: 'unreadable' };
  if (!text.trim()) return { kind: 'empty' };
  return classifyText(text);
}

function getActiveSectionElements(): CanvasElement[] {
  const state = useNotesStore.getState();
  const notebook = state.notebooks.find((nb) => nb.id === state.activeNotebookId);
  const section = notebook?.sections.find((sec) => sec.id === state.activeSectionId);
  return section?.elements ?? [];
}

function getNextZIndex(): number {
  return getActiveSectionElements().reduce((max, el) => Math.max(max, el.zIndex), 100) + 1;
}

function getInsertionPoint(placement: PastePlacement): { x: number; y: number } {
  if (placement.point) return placement.point;
  if (placement.anchor) {
    const bounds = getElementBounds(placement.anchor);
    return { x: bounds.maxX + PASTE_GAP, y: bounds.minY };
  }
  return { x: 0, y: 0 };
}

function measureImage(blob: Blob): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const naturalWidth = img.naturalWidth || 400;
      const naturalHeight = img.naturalHeight || 300;
      URL.revokeObjectURL(url);
      const width = Math.min(500, naturalWidth);
      resolve({ width, height: Math.round(width * (naturalHeight / naturalWidth)) });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read image'));
    };
    img.src = url;
  });
}

async function pasteImage(blob: Blob, placement: PastePlacement) {
  const point = getInsertionPoint(placement);
  const imageKey = `img:${crypto.randomUUID()}`;
  await putPageImage(imageKey, blob);

  const { width, height } = await measureImage(blob);
  const element: ImageElement = {
    id: crypto.randomUUID(),
    type: 'image',
    name: `Pasted Image ${new Date().toLocaleTimeString()}`,
    x: Math.round(point.x),
    y: Math.round(point.y),
    width,
    height,
    imageKey,
    isLocked: false,
    zIndex: getNextZIndex(),
  };

  useNotesStore.getState().addElement(element);
  useUiStore.getState().setSelectedId(element.id);
  showToast('Pasted image from clipboard');
}

function pasteText(text: string, placement: PastePlacement) {
  const point = getInsertionPoint(placement);
  const content = text
    .split('\n')
    .map((line) => `<p>${escapeHtml(line) || '<br>'}</p>`)
    .join('');

  const { textDefaults } = useUiStore.getState();
  const element: TextElement = {
    id: crypto.randomUUID(),
    type: 'text',
    x: Math.round(point.x),
    y: Math.round(point.y),
    width: 340,
    height: null,
    content: content || '<p></p>',
    fontFamily: textDefaults.fontFamily,
    fontSize: textDefaults.fontSize,
    color: textDefaults.color || undefined,
    isBold: textDefaults.isBold,
    zIndex: getNextZIndex(),
  };

  useNotesStore.getState().addElement(element);
  useUiStore.getState().setSelectedId(element.id);
  showToast('Pasted text note');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Best-effort check used to grey out Paste. Returns true when we cannot
 * confidently determine that the system clipboard is empty.
 */
export async function hasClipboardContent(): Promise<boolean> {
  const payload = await readSystemClipboard();

  switch (payload.kind) {
    case 'empty':
      return (useUiStore.getState().clipboardElements?.length ?? 0) > 0;
    case 'unreadable':
    case 'placeholder':
      return true;
    default:
      return true;
  }
}

/**
 * Single paste path for menu buttons. Always prefers the most recent system
 * clipboard contents, then falls back to the in-app clipboard.
 */
export async function pasteFromClipboard(placement: PastePlacement = {}): Promise<void> {
  const payload = await readSystemClipboard();

  if (payload.kind === 'image') {
    try {
      await pasteImage(payload.image, placement);
    } catch (err) {
      console.error('Failed to paste image from clipboard:', err);
      showToast('Could not paste image');
    }
    return;
  }

  if (payload.kind === 'elements') {
    if (placement.anchor) {
      insertElementsNear(payload.elements, placement.anchor);
    } else {
      insertElementsAt(payload.elements, getInsertionPoint(placement).x, getInsertionPoint(placement).y);
    }
    return;
  }

  if (payload.kind === 'text') {
    pasteText(payload.text, placement);
    return;
  }

  // The clipboard only contains our own marker (or could not be read) — use
  // the in-app clipboard snapshot so Cmd+C / Cmd+V stay in sync.
  const fallback = useUiStore.getState().clipboardElements;
  if ((payload.kind === 'placeholder' || payload.kind === 'unreadable') && fallback && fallback.length > 0) {
    if (placement.anchor) {
      pasteClipboardNear(placement.anchor);
    } else {
      const point = getInsertionPoint(placement);
      pasteClipboardAt(point.x, point.y);
    }
    return;
  }

  showToast('Clipboard is empty');
}
