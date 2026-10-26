import { CanvasElement, Section } from '../types';
import { useNotesStore } from '../store/useNotesStore';
import { useUiStore } from '../store/useUiStore';

const DUPLICATE_OFFSET = 32;
const PASTE_GAP = 24;
const PASTE_STEP = 24;

interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function getActiveSection(): Section | undefined {
  const state = useNotesStore.getState();
  const notebook = state.notebooks.find((nb) => nb.id === state.activeNotebookId);
  return notebook?.sections.find((sec) => sec.id === state.activeSectionId);
}

/** All currently selected elements in the active section. */
export function getSelectedElements(fallback?: CanvasElement): CanvasElement[] {
  const section = getActiveSection();
  if (!section) return fallback ? [fallback] : [];

  const { selectedId, selectedIds } = useUiStore.getState();
  const ids = new Set<string>(selectedIds);
  if (selectedId) ids.add(selectedId);

  const selected = section.elements.filter((el) => ids.has(el.id));

  // If the card that owns this action bar isn't part of the current selection
  // (e.g. its bar is visible on hover), scope the action to that card alone.
  if (fallback && !ids.has(fallback.id)) return [fallback];

  if (selected.length === 0 && fallback) return [fallback];
  return selected;
}

export function getElementBounds(element: CanvasElement): Bounds {
  if (element.type === 'arrow') {
    return {
      minX: Math.min(element.startX, element.endX),
      minY: Math.min(element.startY, element.endY),
      maxX: Math.max(element.startX, element.endX),
      maxY: Math.max(element.startY, element.endY),
    };
  }

  const width = 'width' in element && typeof element.width === 'number' ? element.width : 0;
  const height =
    'height' in element && typeof element.height === 'number' && element.height !== null
      ? element.height
      : 80;

  return {
    minX: element.x,
    minY: element.y,
    maxX: element.x + width,
    maxY: element.y + height,
  };
}

function getGroupBounds(elements: CanvasElement[]): Bounds {
  return elements.reduce<Bounds>(
    (acc, el) => {
      const b = getElementBounds(el);
      return {
        minX: Math.min(acc.minX, b.minX),
        minY: Math.min(acc.minY, b.minY),
        maxX: Math.max(acc.maxX, b.maxX),
        maxY: Math.max(acc.maxY, b.maxY),
      };
    },
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
  );
}

function cloneWithOffset(
  elements: CanvasElement[],
  dx: number,
  dy: number,
  startZ: number
): CanvasElement[] {
  return elements.map((el, index) => {
    const zIndex = startZ + index;

    if (el.type === 'arrow') {
      return {
        ...el,
        id: crypto.randomUUID(),
        startX: el.startX + dx,
        startY: el.startY + dy,
        endX: el.endX + dx,
        endY: el.endY + dy,
        x: el.x + dx,
        y: el.y + dy,
        zIndex,
      };
    }

    return {
      ...el,
      id: crypto.randomUUID(),
      x: el.x + dx,
      y: el.y + dy,
      zIndex,
    };
  });
}

function getMaxZIndex(section: Section): number {
  return section.elements.reduce((max, el) => Math.max(max, el.zIndex), 100);
}

function selectElements(elements: CanvasElement[]) {
  const ui = useUiStore.getState();
  if (elements.length === 1) {
    ui.setSelectedId(elements[0].id);
  } else {
    ui.setSelectedIds(elements.map((el) => el.id));
  }
}

function showToast(message: string) {
  window.dispatchEvent(new CustomEvent('notebook-toast', { detail: message }));
}

function getPlainText(elements: CanvasElement[]): string {
  if (elements.length === 1 && elements[0].type === 'text') {
    const temp = document.createElement('div');
    temp.innerHTML = elements[0].content;
    return temp.textContent || temp.innerText || '';
  }
  return `[Notebook Elements (${elements.length} items)]`;
}

/**
 * Plain text written by our most recent in-app copy. Used to recognize our own
 * clipboard content when the WebView does not expose the custom MIME payload,
 * so Cmd+V and the in-app Paste buttons always paste the same thing.
 */
let lastCopiedPlainText: string | null = null;

/** Remember the plain-text representation written by an in-app copy. */
export function rememberCopiedPlainText(text: string) {
  lastCopiedPlainText = text;
}

/** True when the clipboard text came from our most recent in-app copy. */
export function isCopiedPlainText(text: string): boolean {
  const hasSnapshot = (useUiStore.getState().clipboardElements?.length ?? 0) > 0;
  return hasSnapshot && lastCopiedPlainText !== null && text === lastCopiedPlainText;
}

/**
 * Writes the copied elements to the system clipboard too, so Cmd+V and the
 * in-app Paste buttons share the same (most recent) clipboard.
 *
 * A programmatic copy through a hidden textarea is used because custom MIME
 * types can only be written from a real `copy` event.
 */
function writeElementsToSystemClipboard(payload: CanvasElement[], plainText: string) {
  const serialized = JSON.stringify(payload);
  rememberCopiedPlainText(plainText);
  let handled = false;

  const onCopy = (event: ClipboardEvent) => {
    if (!event.clipboardData) return;
    event.clipboardData.setData('application/x-notebook-elements', serialized);
    event.clipboardData.setData('text/plain', plainText);
    event.preventDefault();
    handled = true;
  };

  const previousFocus = document.activeElement as HTMLElement | null;
  const textarea = document.createElement('textarea');
  textarea.value = plainText;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.left = '-10000px';
  textarea.style.top = '0';
  textarea.style.opacity = '0';

  window.addEventListener('copy', onCopy, true);
  document.body.appendChild(textarea);

  let copied = false;
  try {
    textarea.focus();
    textarea.select();
    textarea.setSelectionRange(0, plainText.length);
    copied = document.execCommand('copy');
  } catch {
    copied = false;
  } finally {
    window.removeEventListener('copy', onCopy, true);
    textarea.remove();
    if (previousFocus && typeof previousFocus.focus === 'function') {
      previousFocus.focus({ preventScroll: true });
    }
  }

  if (!copied || !handled) {
    navigator.clipboard?.writeText(plainText).catch(() => {});
  }
}

/** Copy elements into both the in-app and system clipboards. */
export function copyElements(elements: CanvasElement[]): boolean {
  if (elements.length === 0) return false;

  const payload = JSON.parse(JSON.stringify(elements)) as CanvasElement[];
  useUiStore.getState().setClipboardElements(payload);
  writeElementsToSystemClipboard(payload, getPlainText(elements));
  showToast(`Copied ${elements.length} item${elements.length > 1 ? 's' : ''}`);
  return true;
}

/** Insert elements with their top-left at a canvas point (used for clipboard payloads). */
export function insertElementsAt(
  elements: CanvasElement[],
  canvasX: number,
  canvasY: number
): CanvasElement[] {
  if (elements.length === 0) return [];
  const section = getActiveSection();
  if (!section) return [];

  const bounds = getGroupBounds(elements);
  const pasteCount = useUiStore.getState().pasteCount ?? 0;

  return insertElements(
    elements,
    canvasX - bounds.minX + pasteCount * PASTE_STEP,
    canvasY - bounds.minY + pasteCount * PASTE_STEP
  );
}

/** Insert elements just to the right of an element (used for clipboard payloads). */
export function insertElementsNear(
  elements: CanvasElement[],
  anchor: CanvasElement
): CanvasElement[] {
  if (elements.length === 0) return [];
  const section = getActiveSection();
  if (!section) return [];

  const bounds = getGroupBounds(elements);
  const anchorBounds = getElementBounds(anchor);
  const pasteCount = useUiStore.getState().pasteCount ?? 0;

  return insertElements(
    elements,
    anchorBounds.maxX + PASTE_GAP - bounds.minX + pasteCount * PASTE_STEP,
    anchorBounds.minY - bounds.minY + pasteCount * PASTE_STEP
  );
}

/** Paste the in-app clipboard near the given element (or offset from the original). */
export function pasteClipboardNear(anchor?: CanvasElement): CanvasElement[] {
  const clipboard = useUiStore.getState().clipboardElements;
  if (!clipboard || clipboard.length === 0) return [];
  if (anchor) return insertElementsNear(clipboard, anchor);
  return insertElementsAt(clipboard, 0, 0);
}

/** Paste the in-app clipboard with its top-left at a specific canvas point. */
export function pasteClipboardAt(canvasX: number, canvasY: number): CanvasElement[] {
  const clipboard = useUiStore.getState().clipboardElements;
  if (!clipboard || clipboard.length === 0) return [];
  return insertElementsAt(clipboard, canvasX, canvasY);
}

function insertElements(
  elements: CanvasElement[],
  dx: number,
  dy: number
): CanvasElement[] {
  const section = getActiveSection();
  if (!section) return [];

  const pasted = cloneWithOffset(elements, dx, dy, getMaxZIndex(section) + 1);
  useNotesStore.getState().addElements(pasted);
  selectElements(pasted);
  useUiStore.getState().incrementPasteCount();
  showToast(`Pasted ${pasted.length} item${pasted.length > 1 ? 's' : ''}`);
  return pasted;
}

/** Duplicate elements with a small offset and place them above everything else. */
export function duplicateElements(elements: CanvasElement[]): CanvasElement[] {
  if (elements.length === 0) return [];

  const section = getActiveSection();
  if (!section) return [];

  const duplicated = cloneWithOffset(
    elements,
    DUPLICATE_OFFSET,
    DUPLICATE_OFFSET,
    getMaxZIndex(section) + 1
  );

  useNotesStore.getState().addElements(duplicated);
  selectElements(duplicated);
  showToast(`Duplicated ${duplicated.length} item${duplicated.length > 1 ? 's' : ''}`);
  return duplicated;
}

/** Delete elements and clear the selection. */
export function removeElements(elements: CanvasElement[]) {
  if (elements.length === 0) return;
  useNotesStore.getState().deleteElements(elements.map((el) => el.id));
  useUiStore.getState().clearSelection();
  useUiStore.getState().setEditingId(null);
}

/** Move elements above everything else in the section. */
export function bringElementsToFront(elements: CanvasElement[]) {
  if (elements.length === 0) return;
  const section = getActiveSection();
  if (!section) return;

  const maxZ = getMaxZIndex(section);
  elements.forEach((el, index) => {
    useNotesStore
      .getState()
      .updateElement(el.id, { zIndex: maxZ + 1 + index }, index === 0);
  });
}

/** Move elements below everything else in the section. */
export function sendElementsToBack(elements: CanvasElement[]) {
  if (elements.length === 0) return;
  const section = getActiveSection();
  if (!section) return;

  const minZ = section.elements.reduce((min, el) => Math.min(min, el.zIndex), 0);
  elements.forEach((el, index) => {
    useNotesStore
      .getState()
      .updateElement(el.id, { zIndex: minZ - elements.length + index }, index === 0);
  });
}
