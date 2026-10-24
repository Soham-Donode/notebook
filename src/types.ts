export const SCHEMA_VERSION = 1;

export interface Notebook {
  id: string;
  name: string;
  folderName?: string;
  folderPath?: string;
  createdAt: number;
  updatedAt: number;
  sections: Section[];
}

export interface Section {
  id: string;
  name: string;
  viewport: Viewport;
  elements: CanvasElement[];
}

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

export interface BaseElement {
  id: string;
  x: number;          // canvas-space, NOT screen-space
  y: number;
  zIndex: number;
}

export interface TextElement extends BaseElement {
  type: 'text';
  width: number;
  height: number | null;   // null = auto-grow
  content: string;         // TipTap HTML
  fontFamily: string;
  fontSize: number;
  color?: string;
  isBold?: boolean;
}

export interface PdfPageElement extends BaseElement {
  type: 'pdf-page';
  pdfId: string;           // groups pages from one import
  pdfName: string;
  pageNumber: number;
  totalPages: number;
  width: number;           // canvas-space CSS px at zoom 1
  height: number;
  imageKey: string;        // IndexedDB key — NOT a data URL. See §7.
  isLocked: boolean;
}

export interface ImageElement extends BaseElement {
  type: 'image';
  name: string;
  width: number;
  height: number;
  imageKey: string;        // IndexedDB key — NOT a data URL. See §7.
  isLocked: boolean;
}

export interface ArrowElement extends BaseElement {
  type: 'arrow';
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  controlOffset?: number; // perpendicular curvature offset
  color?: string;
  strokeWidth?: number;
  arrowHeadPosition?: 'start' | 'end' | 'both';
}

export type CanvasElement = TextElement | PdfPageElement | ImageElement | ArrowElement;

export type ToolMode = 'select' | 'hand' | 'arrow';

/** Last-used text styling, applied to newly created notes. */
export interface TextDefaults {
  fontFamily: string;
  fontSize: number;
  color: string;
  isBold: boolean;
}

/** Transient — never persisted */
export interface UiState {
  selectedId: string | null;
  selectedIds: string[];
  editingId: string | null;
  isSidebarOpen: boolean;
  isImporting: boolean;
  importProgress: { done: number; total: number } | null;
  activeTool: ToolMode;
  clipboardElements?: CanvasElement[] | null;
  pasteCount?: number;
  textDefaults: TextDefaults;
}
