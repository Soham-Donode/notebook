import html2canvas from 'html2canvas-pro';
import { jsPDF } from 'jspdf';
import { save } from '@tauri-apps/plugin-dialog';
import { writeFile } from '@tauri-apps/plugin-fs';
import {
  ArrowElement,
  CanvasElement,
  ImageElement,
  PdfPageElement,
  RectElement,
  TextElement,
} from '../types';
import { getPageImageUrl } from '../store/imageStore';
import { resolveShapeColor, withAlpha } from './color';

/* -------------------------------------------------------------------------- */
/*  Public types                                                              */
/* -------------------------------------------------------------------------- */

export type PdfPaperSize = 'a4' | 'letter';
export type PdfOrientation = 'auto' | 'portrait' | 'landscape';

export interface PdfExportOptions {
  paper?: PdfPaperSize;
  orientation?: PdfOrientation;
  /** Page background colour. Default: '#ffffff'. */
  backgroundColor?: string;
  /** Footer with "Page 1 of 12". Default: true. */
  includePageNumbers?: boolean;
  /** Notebook + section name strip above each page. Default: true. */
  includeHeader?: boolean;
  signal?: AbortSignal;
  onProgress?: (progress: PdfExportProgress) => void;
}

export interface PdfExportProgress {
  phase: 'preparing' | 'rendering' | 'saving';
  done: number;
  total: number;
  message: string;
}

export interface PdfExportResult {
  /** False when the user dismissed the native "save as" dialog. */
  saved: boolean;
  pages: number;
}

export class PdfExportCancelled extends Error {
  constructor() {
    super('PDF export cancelled');
    this.name = 'PdfExportCancelled';
  }
}

/* -------------------------------------------------------------------------- */
/*  Print geometry                                                            */
/* -------------------------------------------------------------------------- */

const MM_PER_INCH = 25.4;
/** Canvas units are CSS pixels, so natural size on paper is 96 dpi. */
const UNITS_PER_MM = 96 / MM_PER_INCH;
/** Render resolution of each page raster. 200 dpi keeps text crisp without bloat. */
const OUTPUT_DPI = 200;

const MARGIN_MM = { top: 17, right: 15, bottom: 17, left: 15 };

const PAPER_MM: Record<PdfPaperSize, { width: number; height: number }> = {
  a4: { width: 210, height: 297 },
  letter: { width: 215.9, height: 279.4 },
};

const NOTE_FONT_FALLBACK = 'Comic Sans MS, Comic Neue, cursive, sans-serif';
const INK = '#1f2937';

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface PlacedBox extends Box {
  el: CanvasElement;
}

interface PageRegion {
  /** Canvas-space window this page shows. */
  left: number;
  top: number;
  width: number;
  height: number;
}

interface PageLayout {
  region: PageRegion;
  /** Canvas units -> page units. */
  scale: number;
  /** Elements visible inside this page's strip. */
  elements: CanvasElement[];
}

interface PdfLayout {
  pages: PageLayout[];
  paperWidthMm: number;
  paperHeightMm: number;
  paperUnitsW: number;
  paperUnitsH: number;
  marginUnits: { top: number; right: number; bottom: number; left: number };
  contentUnits: { width: number; height: number };
}

interface ExportPalette {
  isDark: boolean;
  background: string;
  mutedInk: string;
  rule: string;
  wordmark: string;
  placeholder: string;
}

/* -------------------------------------------------------------------------- */
/*  Small helpers                                                             */
/* -------------------------------------------------------------------------- */

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => setTimeout(resolve, 0));
    } else {
      setTimeout(resolve, 0);
    }
  });
}

function assertLive(signal?: AbortSignal) {
  if (signal?.aborted) throw new PdfExportCancelled();
}

/** Relative luminance of a CSS colour, used to keep light-on-dark text printable. */
function luminance(color: string): number {
  const value = color.trim().toLowerCase();
  if (value === 'white') return 1;
  if (value === 'black') return 0;
  const hex = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!hex) return 0.5;
  const raw = hex[1].length === 3 ? hex[1].split('').map((c) => c + c).join('') : hex[1];
  const r = parseInt(raw.slice(0, 2), 16) / 255;
  const g = parseInt(raw.slice(2, 4), 16) / 255;
  const b = parseInt(raw.slice(4, 6), 16) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Notes written for dark mode use light ink; flip it so paper stays readable. */
function resolveExportInk(color: string | undefined, darkPaper = false): string {
  if (!color) return darkPaper ? '#f3f4f6' : INK;
  const value = luminance(color);
  if (darkPaper) return value < 0.32 ? '#f3f4f6' : color;
  return value > 0.78 ? INK : color;
}

function createExportPalette(background: string): ExportPalette {
  const isDark = luminance(background) < 0.45;
  return {
    isDark,
    background,
    mutedInk: isDark ? 'rgba(255, 255, 255, 0.62)' : '#9ca3af',
    rule: isDark ? 'rgba(255, 255, 255, 0.14)' : '#e5e7eb',
    wordmark: isDark ? 'rgba(255, 255, 255, 0.24)' : '#c7cbd1',
    placeholder: isDark ? 'rgba(255, 255, 255, 0.08)' : '#f3f4f6',
  };
}

function sanitiseFilename(name: string): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .slice(0, 100);
  return `${cleaned || 'Notebook export'}.pdf`;
}

/* -------------------------------------------------------------------------- */
/*  Arrow geometry (shared by arrow bounds and raster pass)                   */
/* -------------------------------------------------------------------------- */

interface ArrowGeometry {
  sx: number;
  sy: number;
  ex: number;
  ey: number;
  pathStartX: number;
  pathStartY: number;
  pathEndX: number;
  pathEndY: number;
  cpx: number;
  cpy: number;
  strokeWidth: number;
  arrowColor: string;
  arrowHeadPosition: 'start' | 'end' | 'both';
  startHead: { tipX: number; tipY: number; leftX: number; leftY: number; rightX: number; rightY: number };
  endHead: { tipX: number; tipY: number; leftX: number; leftY: number; rightX: number; rightY: number };
}

function computeArrowGeometry(
  el: ArrowElement,
  originX: number,
  originY: number,
  darkPaper = false
): ArrowGeometry {
  const { startX, startY, endX, endY } = el;
  const strokeWidth = el.strokeWidth || 1.8;
  const arrowColor = resolveExportInk(
    el.color || resolveShapeColor(el.color, false),
    darkPaper
  );
  const arrowHeadPosition = el.arrowHeadPosition || 'start';

  const dx = endX - startX;
  const dy = endY - startY;
  const safeDist = Math.max(Math.hypot(dx, dy), 1);
  const nx = -dy / safeDist;
  const ny = dx / safeDist;
  const curvature =
    el.controlOffset !== undefined ? el.controlOffset : Math.max(28, Math.min(260, safeDist * 0.28));

  const cx = (startX + endX) / 2 + nx * curvature;
  const cy = (startY + endY) / 2 + ny * curvature;

  const headLen = 11.5;
  const headWidth = 4.2;
  const hasStartHead = arrowHeadPosition === 'start' || arrowHeadPosition === 'both';
  const hasEndHead = arrowHeadPosition === 'end' || arrowHeadPosition === 'both';

  const startVecX = startX - cx;
  const startVecY = startY - cy;
  const startLen = Math.hypot(startVecX, startVecY) || 1;
  const uxStart = startVecX / startLen;
  const uyStart = startVecY / startLen;

  const endVecX = endX - cx;
  const endVecY = endY - cy;
  const endLen = Math.hypot(endVecX, endVecY) || 1;
  const uxEnd = endVecX / endLen;
  const uyEnd = endVecY / endLen;

  const startTipX = startX - originX;
  const startTipY = startY - originY;
  const startBaseX = startTipX - uxStart * headLen;
  const startBaseY = startTipY - uyStart * headLen;
  const startLeftX = startBaseX - uyStart * headWidth;
  const startLeftY = startBaseY + uxStart * headWidth;
  const startRightX = startBaseX + uyStart * headWidth;
  const startRightY = startBaseY - uxStart * headWidth;

  const endTipX = endX - originX;
  const endTipY = endY - originY;
  const endBaseX = endTipX - uxEnd * headLen;
  const endBaseY = endTipY - uyEnd * headLen;
  const endLeftX = endBaseX - uyEnd * headWidth;
  const endLeftY = endBaseY + uxEnd * headWidth;
  const endRightX = endBaseX + uyEnd * headWidth;
  const endRightY = endBaseY - uxEnd * headWidth;

  const pathStartX = hasStartHead ? startTipX - uxStart * (headLen - 2) : startX - originX;
  const pathStartY = hasStartHead ? startTipY - uyStart * (headLen - 2) : startY - originY;
  const pathEndX = hasEndHead ? endTipX - uxEnd * (headLen - 2) : endX - originX;
  const pathEndY = hasEndHead ? endTipY - uyEnd * (headLen - 2) : endY - originY;

  return {
    sx: startX - originX,
    sy: startY - originY,
    ex: endX - originX,
    ey: endY - originY,
    pathStartX,
    pathStartY,
    pathEndX,
    pathEndY,
    cpx: cx - originX,
    cpy: cy - originY,
    strokeWidth,
    arrowColor,
    arrowHeadPosition,
    startHead: {
      tipX: startTipX,
      tipY: startTipY,
      leftX: startLeftX,
      leftY: startLeftY,
      rightX: startRightX,
      rightY: startRightY,
    },
    endHead: {
      tipX: endTipX,
      tipY: endTipY,
      leftX: endLeftX,
      leftY: endLeftY,
      rightX: endRightX,
      rightY: endRightY,
    },
  };
}

function arrowBox(el: ArrowElement): Box {
  const geo = computeArrowGeometry(el, 0, 0);
  const xs = [
    geo.sx,
    geo.ex,
    geo.cpx,
    geo.startHead.leftX,
    geo.startHead.rightX,
    geo.endHead.leftX,
    geo.endHead.rightX,
  ];
  const ys = [
    geo.sy,
    geo.ey,
    geo.cpy,
    geo.startHead.leftY,
    geo.startHead.rightY,
    geo.endHead.leftY,
    geo.endHead.rightY,
  ];
  const pad = Math.max(4, geo.strokeWidth * 2);
  const minX = Math.min(...xs) - pad;
  const minY = Math.min(...ys) - pad;
  const maxX = Math.max(...xs) + pad;
  const maxY = Math.max(...ys) + pad;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function drawArrow(
  ctx: CanvasRenderingContext2D,
  arrow: ArrowElement,
  originX: number,
  originY: number,
  scale: number,
  darkPaper = false
) {
  const geo = computeArrowGeometry(arrow, originX, originY, darkPaper);

  ctx.save();
  ctx.scale(scale, scale);

  ctx.beginPath();
  ctx.moveTo(geo.pathStartX, geo.pathStartY);
  ctx.quadraticCurveTo(geo.cpx, geo.cpy, geo.pathEndX, geo.pathEndY);
  ctx.strokeStyle = geo.arrowColor;
  ctx.lineWidth = geo.strokeWidth;
  ctx.lineCap = 'round';
  ctx.stroke();

  const drawHead = (head: ArrowGeometry['startHead']) => {
    ctx.beginPath();
    ctx.moveTo(head.tipX, head.tipY);
    ctx.lineTo(head.leftX, head.leftY);
    ctx.lineTo(head.rightX, head.rightY);
    ctx.closePath();
    ctx.fillStyle = geo.arrowColor;
    ctx.fill();
  };

  if (geo.arrowHeadPosition === 'start' || geo.arrowHeadPosition === 'both') drawHead(geo.startHead);
  if (geo.arrowHeadPosition === 'end' || geo.arrowHeadPosition === 'both') drawHead(geo.endHead);

  ctx.restore();
}

/* -------------------------------------------------------------------------- */
/*  Text measurement + DOM construction                                       */
/* -------------------------------------------------------------------------- */

/** Builds the same note markup the canvas uses, so print typography matches. */
function createTextNote(el: TextElement, scale: number, darkPaper = false): HTMLDivElement {
  const width = Math.max(48, el.width || 340);

  const card = document.createElement('div');
  card.style.boxSizing = 'border-box';
  card.style.width = `${width * scale}px`;
  card.style.padding = `${8 * scale}px`;
  card.style.fontFamily = el.fontFamily || NOTE_FONT_FALLBACK;
  card.style.fontSize = `${(el.fontSize || 18) * scale}px`;
  card.style.fontWeight = el.isBold ? '700' : '400';
  card.style.color = resolveExportInk(el.color, darkPaper);
  card.style.overflowWrap = 'anywhere';
  card.style.wordBreak = 'break-word';

  const body = document.createElement('div');
  body.className = 'notebook-note';
  body.style.lineHeight = '1.6';
  body.innerHTML = el.content;
  card.appendChild(body);

  return card;
}

async function measureTextHeights(
  textElements: TextElement[],
  signal: AbortSignal | undefined,
  onProgress: PdfExportOptions['onProgress']
): Promise<Map<string, number>> {
  const heights = new Map<string, number>();
  if (textElements.length === 0) return heights;

  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText =
    'position:fixed;left:-12000px;top:0;width:1600px;height:0;overflow:visible;pointer-events:none;opacity:0;contain:layout style;';
  document.body.appendChild(host);

  try {
    for (let i = 0; i < textElements.length; i++) {
      assertLive(signal);
      const el = textElements[i];
      const card = createTextNote(el, 1);
      host.appendChild(card);
      const height = Math.max(24, Math.ceil(card.getBoundingClientRect().height));
      heights.set(el.id, height);
      host.removeChild(card);

      if (i % 12 === 11) {
        onProgress?.({
          phase: 'preparing',
          done: i + 1,
          total: textElements.length,
          message: 'Measuring notes…',
        });
        await nextFrame();
      }
    }
  } finally {
    host.remove();
  }

  return heights;
}

/* -------------------------------------------------------------------------- */
/*  Layout planning                                                           */
/* -------------------------------------------------------------------------- */

function elementBox(el: CanvasElement, textHeights: Map<string, number>): Box {
  switch (el.type) {
    case 'arrow':
      return arrowBox(el);
    case 'text': {
      const width = Math.max(48, el.width || 340);
      const height = textHeights.get(el.id) ?? el.height ?? Math.max(80, (el.fontSize || 18) * 4);
      return { x: el.x, y: el.y, w: width, h: height };
    }
    case 'pdf-page':
    case 'image':
    case 'rect':
      return { x: el.x, y: el.y, w: Math.max(8, el.width), h: Math.max(8, el.height) };
    default:
      return { x: 0, y: 0, w: 1, h: 1 };
  }
}

function unionBounds(boxes: PlacedBox[]): { top: number; bottom: number; left: number; right: number } {
  let top = Infinity;
  let bottom = -Infinity;
  let left = Infinity;
  let right = -Infinity;
  for (const box of boxes) {
    top = Math.min(top, box.y);
    bottom = Math.max(bottom, box.y + box.h);
    left = Math.min(left, box.x);
    right = Math.max(right, box.x + box.w);
  }
  return { top, bottom, left, right };
}

/**
 * Divides the section's bounding rectangle into horizontal strips.
 *
 * The rectangle spans from the top-left of the top-left-most element to the
 * bottom-right of the bottom-right-most element. Its width is fitted to the
 * printable page width, then it is sliced top-to-bottom into page-sized bands.
 * Every page shows a vertical slice of the same rectangle, so content keeps its
 * position on the canvas instead of being re-flowed into columns.
 */
function planSheet(boxes: PlacedBox[], paper: PdfPaperSize, landscape: boolean): PdfLayout {
  const base = PAPER_MM[paper];
  const paperWidthMm = landscape ? base.height : base.width;
  const paperHeightMm = landscape ? base.width : base.height;
  const contentWidthMm = paperWidthMm - MARGIN_MM.left - MARGIN_MM.right;
  const contentHeightMm = paperHeightMm - MARGIN_MM.top - MARGIN_MM.bottom;

  const paperUnitsW = paperWidthMm * UNITS_PER_MM;
  const paperUnitsH = paperHeightMm * UNITS_PER_MM;
  const marginUnits = {
    top: MARGIN_MM.top * UNITS_PER_MM,
    right: MARGIN_MM.right * UNITS_PER_MM,
    bottom: MARGIN_MM.bottom * UNITS_PER_MM,
    left: MARGIN_MM.left * UNITS_PER_MM,
  };
  const contentUnits = {
    width: contentWidthMm * UNITS_PER_MM,
    height: contentHeightMm * UNITS_PER_MM,
  };

  const bounds = unionBounds(boxes);
  const boundsWidth = Math.max(1, bounds.right - bounds.left);
  const boundsHeight = Math.max(1, bounds.bottom - bounds.top);

  // Always fit the full width, but never enlarge content past its natural size.
  const scale = Math.min(1, contentUnits.width / boundsWidth);
  const windowW = contentUnits.width / scale;
  const windowH = contentUnits.height / scale;

  // Centre the rectangle horizontally. The first strip starts exactly at its
  // top edge, so nothing above the first page is lost.
  const regionLeft = bounds.left - (windowW - boundsWidth) / 2;
  const pageCount = Math.max(1, Math.ceil(boundsHeight / windowH - 1e-6));

  const pages: PageLayout[] = [];
  for (let index = 0; index < pageCount; index++) {
    const region: PageRegion = {
      left: regionLeft,
      top: bounds.top + index * windowH,
      width: windowW,
      height: windowH,
    };
    const regionRight = region.left + region.width;
    const regionBottom = region.top + region.height;

    pages.push({
      region,
      scale,
      // Keep only what is visible on this strip. Elements crossing a cut are
      // clipped by the printable content box and continue on the next page.
      elements: boxes
        .filter(
          (box) =>
            box.x < regionRight &&
            box.x + box.w > region.left &&
            box.y < regionBottom &&
            box.y + box.h > region.top
        )
        .map((box) => box.el),
    });
  }

  return {
    pages,
    paperWidthMm,
    paperHeightMm,
    paperUnitsW,
    paperUnitsH,
    marginUnits,
    contentUnits,
  };
}

function planLayout(
  elements: CanvasElement[],
  textHeights: Map<string, number>,
  paper: PdfPaperSize,
  orientation: PdfOrientation
): PdfLayout {
  const boxes = elements.map((el) => ({ ...elementBox(el, textHeights), el }));

  if (orientation !== 'auto') {
    return planSheet(boxes, paper, orientation === 'landscape');
  }

  // Auto: prefer fewer sheets, then the orientation that prints larger.
  const portrait = planSheet(boxes, paper, false);
  const landscape = planSheet(boxes, paper, true);

  if (portrait.pages.length !== landscape.pages.length) {
    return portrait.pages.length < landscape.pages.length ? portrait : landscape;
  }

  const portraitScale = portrait.pages[0]?.scale ?? 1;
  const landscapeScale = landscape.pages[0]?.scale ?? 1;
  return landscapeScale > portraitScale + 1e-4 ? landscape : portrait;
}

/* -------------------------------------------------------------------------- */
/*  Page rendering                                                            */
/* -------------------------------------------------------------------------- */

interface PageMeta {
  notebookName: string;
  sectionName: string;
  includeHeader: boolean;
  includePageNumbers: boolean;
  pageNumber: number;
  totalPages: number;
}

function addHeaderFooter(
  root: HTMLDivElement,
  layout: PdfLayout,
  meta: PageMeta,
  palette: ExportPalette
) {
  const { paperUnitsW, marginUnits } = layout;
  const smallUnit = Math.max(8, marginUnits.top * 0.22);
  const ink = palette.mutedInk;
  const innerLeft = marginUnits.left;
  const innerRight = paperUnitsW - marginUnits.right;
  const headerBaseline = marginUnits.top * 0.42;

  if (meta.includeHeader) {
    const left = document.createElement('span');
    left.textContent = meta.notebookName.toUpperCase();
    left.style.cssText = `position:absolute;left:${innerLeft}px;top:${headerBaseline}px;max-width:${
      (innerRight - innerLeft) * 0.5
    }px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:${smallUnit}px;letter-spacing:${
      smallUnit * 0.1
    }px;color:${ink};font-weight:600;`;

    const right = document.createElement('span');
    right.textContent = meta.sectionName;
    right.style.cssText = `position:absolute;right:${
      paperUnitsW - innerRight
    }px;top:${headerBaseline}px;max-width:${
      (innerRight - innerLeft) * 0.5
    }px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:right;font-size:${smallUnit}px;color:${ink};`;

    const rule = document.createElement('div');
    rule.style.cssText = `position:absolute;left:${innerLeft}px;right:${
      paperUnitsW - innerRight
    }px;top:${headerBaseline + smallUnit * 1.6}px;height:${Math.max(
      0.6,
      smallUnit * 0.08
    )}px;background:${palette.rule};`;

    root.append(left, right, rule);
  }

  if (meta.includePageNumbers) {
    const footer = document.createElement('span');
    footer.textContent = `${meta.pageNumber} / ${meta.totalPages}`;
    footer.style.cssText = `position:absolute;right:${
      paperUnitsW - innerRight
    }px;bottom:${marginUnits.bottom * 0.4}px;font-size:${smallUnit}px;letter-spacing:${
      smallUnit * 0.08
    }px;color:${ink};`;

    const wordmark = document.createElement('span');
    wordmark.textContent = 'NOTEBOOK';
    wordmark.style.cssText = `position:absolute;left:${innerLeft}px;bottom:${
      marginUnits.bottom * 0.4
    }px;font-size:${smallUnit * 0.9}px;letter-spacing:${smallUnit * 0.16}px;color:${
      palette.wordmark
    };font-weight:600;`;

    root.append(footer, wordmark);
  }
}

function buildPageElement(
  page: PageLayout,
  layout: PdfLayout,
  meta: PageMeta,
  imageUrls: Map<string, string>,
  palette: ExportPalette
): HTMLDivElement {
  const root = document.createElement('div');
  root.style.cssText = `position:absolute;left:-12000px;top:0;width:${layout.paperUnitsW}px;height:${layout.paperUnitsH}px;background:${palette.background};overflow:hidden;pointer-events:none;z-index:-1;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;`;
  root.setAttribute('data-pdf-export-page', 'true');

  addHeaderFooter(root, layout, meta, palette);

  // Decoration may stick out of the content box; keep it out of the header and
  // footer by clipping everything to the printable area.
  const content = document.createElement('div');
  content.style.position = 'absolute';
  content.style.left = `${layout.marginUnits.left}px`;
  content.style.top = `${layout.marginUnits.top}px`;
  content.style.width = `${layout.contentUnits.width}px`;
  content.style.height = `${layout.contentUnits.height}px`;
  content.style.overflow = 'hidden';
  root.appendChild(content);

  const { scale, region } = page;
  const sorted = [...page.elements]
    .filter((el) => el.type !== 'arrow')
    .sort((a, b) => a.zIndex - b.zIndex);

  for (const el of sorted) {
    const left = (el.x - region.left) * scale;
    const top = (el.y - region.top) * scale;

    if (el.type === 'text') {
      const note = createTextNote(el as TextElement, scale, palette.isDark);
      note.style.position = 'absolute';
      note.style.left = `${left}px`;
      note.style.top = `${top}px`;
      note.style.zIndex = String(el.zIndex);
      content.appendChild(note);
      continue;
    }

    if (el.type === 'pdf-page' || el.type === 'image') {
      const image = el as PdfPageElement | ImageElement;
      const wrapper = document.createElement('div');
      const radius = (el.type === 'pdf-page' ? 16 : 12) * scale;
      wrapper.style.position = 'absolute';
      wrapper.style.left = `${left}px`;
      wrapper.style.top = `${top}px`;
      wrapper.style.width = `${image.width * scale}px`;
      wrapper.style.height = `${image.height * scale}px`;
      wrapper.style.borderRadius = `${radius}px`;
      wrapper.style.overflow = 'hidden';
      wrapper.style.zIndex = String(el.zIndex);
      wrapper.style.background = palette.placeholder;
      wrapper.style.boxShadow = `0 ${Math.max(1, scale)}px ${Math.max(
        2,
        10 * scale
      )}px ${palette.isDark ? 'rgba(0, 0, 0, 0.45)' : 'rgba(17, 24, 39, 0.10)'}`;

      const url = imageUrls.get(image.imageKey);
      if (url) {
        const img = document.createElement('img');
        img.src = url;
        img.alt = '';
        img.style.width = '100%';
        img.style.height = '100%';
        img.style.objectFit = 'fill';
        img.style.display = 'block';
        wrapper.appendChild(img);
      } else {
        const missing = document.createElement('div');
        missing.textContent = 'Image unavailable';
        missing.style.cssText = `width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:${palette.mutedInk};font-family:sans-serif;font-size:11px;`;
        wrapper.appendChild(missing);
      }

      content.appendChild(wrapper);
      continue;
    }

    if (el.type === 'rect') {
      const rect = el as RectElement;
      const stroke = resolveExportInk(resolveShapeColor(rect.color, false), palette.isDark);
      const node = document.createElement('div');
      node.style.position = 'absolute';
      node.style.left = `${left}px`;
      node.style.top = `${top}px`;
      node.style.width = `${rect.width * scale}px`;
      node.style.height = `${rect.height * scale}px`;
      node.style.border = `${Math.max(0.75, rect.strokeWidth * scale)}px solid ${stroke}`;
      node.style.background = withAlpha(stroke, 0.1);
      node.style.borderRadius = `${Math.min(rect.radius, rect.width / 2, rect.height / 2) * scale}px`;
      node.style.boxSizing = 'border-box';
      node.style.zIndex = String(el.zIndex);
      content.appendChild(node);
      continue;
    }

    // Arrows are composited after rasterisation so their curves stay crisp.
  }

  return root;
}

/* -------------------------------------------------------------------------- */
/*  Image preloading                                                          */
/* -------------------------------------------------------------------------- */

async function loadImageUrls(
  elements: CanvasElement[],
  signal?: AbortSignal
): Promise<Map<string, string>> {
  const keys = new Set<string>();
  for (const el of elements) {
    if ((el.type === 'pdf-page' || el.type === 'image') && el.imageKey) keys.add(el.imageKey);
  }

  const map = new Map<string, string>();
  const list = Array.from(keys);

  for (let i = 0; i < list.length; i++) {
    assertLive(signal);
    const url = await getPageImageUrl(list[i]);
    if (url) {
      map.set(list[i], url);
      try {
        const img = new Image();
        img.src = url;
        if (typeof img.decode === 'function') await img.decode();
      } catch {
        // A broken image should not abort the whole export.
      }
    }
    if (i % 4 === 3) await nextFrame();
  }

  return map;
}

/* -------------------------------------------------------------------------- */
/*  Public entry point                                                        */
/* -------------------------------------------------------------------------- */

export async function exportSectionToPdf(
  elements: CanvasElement[],
  notebookName: string,
  sectionName: string,
  options: PdfExportOptions = {}
): Promise<PdfExportResult> {
  const {
    paper = 'a4',
    orientation = 'auto',
    backgroundColor = '#ffffff',
    includePageNumbers = true,
    includeHeader = true,
    signal,
    onProgress,
  } = options;

  if (elements.length === 0) {
    throw new Error('This section is empty — add a note or import a page first.');
  }

  const palette = createExportPalette(backgroundColor);

  const filename = sanitiseFilename(`${notebookName || 'Notebook'} - ${sectionName || 'Section'}`);

  // Ask where to save before doing any heavy work so cancelling is instant.
  let savePath: string | null = null;
  const isTauri = typeof window !== 'undefined' && Boolean((window as any).__TAURI_INTERNALS__);

  if (isTauri) {
    savePath = await save({
      defaultPath: filename,
      filters: [{ name: 'PDF Document', extensions: ['pdf'] }],
    });
    if (!savePath) return { saved: false, pages: 0 };
    if (!savePath.toLowerCase().endsWith('.pdf')) savePath = `${savePath}.pdf`;
  }

  assertLive(signal);
  onProgress?.({ phase: 'preparing', done: 0, total: 1, message: 'Preparing export…' });
  await nextFrame();

  try {
    await document.fonts?.ready;
  } catch {
    // Older WebViews can reject here; rendering still works with fallbacks.
  }

  const textElements = elements.filter((el): el is TextElement => el.type === 'text');
  const textHeights = await measureTextHeights(textElements, signal, onProgress);

  assertLive(signal);
  const layout = planLayout(elements, textHeights, paper, orientation);

  if (layout.pages.length === 0) {
    throw new Error('Nothing on this canvas could be laid out.');
  }

  onProgress?.({
    phase: 'preparing',
    done: 0,
    total: layout.pages.length,
    message: `Laying out ${layout.pages.length} page${layout.pages.length === 1 ? '' : 's'}…`,
  });
  await nextFrame();

  const imageUrls = await loadImageUrls(elements, signal);

  const doc = new jsPDF({
    orientation: layout.paperWidthMm >= layout.paperHeightMm ? 'landscape' : 'portrait',
    unit: 'mm',
    format: [layout.paperWidthMm, layout.paperHeightMm],
    compress: true,
  });

  doc.setProperties({
    title: `${notebookName} — ${sectionName}`,
    subject: `${layout.pages.length}-page export from Notebook`,
    author: 'Notebook',
    creator: 'Notebook',
  });

  const outputWidth = Math.round((layout.paperWidthMm / MM_PER_INCH) * OUTPUT_DPI);
  const outputScale = outputWidth / layout.paperUnitsW;
  const pageWidthMm = doc.internal.pageSize.getWidth();
  const pageHeightMm = doc.internal.pageSize.getHeight();

  for (let index = 0; index < layout.pages.length; index++) {
    assertLive(signal);

    const page = layout.pages[index];
    onProgress?.({
      phase: 'rendering',
      done: index,
      total: layout.pages.length,
      message: `Rendering page ${index + 1} of ${layout.pages.length}…`,
    });
    await nextFrame();
    assertLive(signal);

    const pageElement = buildPageElement(
      page,
      layout,
      {
        notebookName,
        sectionName,
        includeHeader,
        includePageNumbers,
        pageNumber: index + 1,
        totalPages: layout.pages.length,
      },
      imageUrls,
      palette
    );

    document.body.appendChild(pageElement);

    try {
      // Make sure every <img> has decoded before html2canvas snapshots the page.
      const pending = Array.from(pageElement.querySelectorAll('img')).map((img) =>
        img.complete
          ? Promise.resolve()
          : new Promise<void>((resolve) => {
              img.onload = () => resolve();
              img.onerror = () => resolve();
            })
      );
      await Promise.all(pending);

      const canvas = await html2canvas(pageElement, {
        backgroundColor: palette.background,
        scale: outputScale,
        logging: false,
        useCORS: true,
        imageTimeout: 15_000,
        onclone: (cloned) => {
          // The export palette replaces the app theme, including in dark mode.
          cloned.documentElement.classList.remove('dark');
        },
      });

      const context = canvas.getContext('2d');
      if (context) {
        const ratio = canvas.width / layout.paperUnitsW;
        context.save();
        context.setTransform(ratio, 0, 0, ratio, 0, 0);
        context.beginPath();
        context.rect(
          layout.marginUnits.left,
          layout.marginUnits.top,
          layout.contentUnits.width,
          layout.contentUnits.height
        );
        context.clip();
        const arrows = new Map<string, ArrowElement>();
        for (const el of page.elements) {
          if (el.type === 'arrow') arrows.set(el.id, el);
        }
        for (const arrow of arrows.values()) {
          drawArrow(context, arrow, page.region.left, page.region.top, page.scale, palette.isDark);
        }
        context.restore();
      }

      if (index > 0) doc.addPage();
      const dataUrl = canvas.toDataURL('image/png');
      doc.addImage(dataUrl, 'PNG', 0, 0, pageWidthMm, pageHeightMm, undefined, 'FAST');

      // Release the large backing store as soon as the page is embedded.
      canvas.width = 0;
      canvas.height = 0;
    } finally {
      pageElement.remove();
    }
  }

  assertLive(signal);
  onProgress?.({
    phase: 'saving',
    done: layout.pages.length,
    total: layout.pages.length,
    message: 'Saving PDF…',
  });
  await nextFrame();

  if (isTauri && savePath) {
    const buffer = doc.output('arraybuffer');
    await writeFile(savePath, new Uint8Array(buffer));
  } else {
    doc.save(filename);
  }

  return { saved: true, pages: layout.pages.length };
}
