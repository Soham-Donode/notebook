import html2canvas from 'html2canvas-pro';
import { jsPDF } from 'jspdf';
import { save } from '@tauri-apps/plugin-dialog';
import { writeFile } from '@tauri-apps/plugin-fs';
import { ArrowElement, CanvasElement, TextElement } from '../types';
import { getPageImageUrl } from '../store/imageStore';
import { withAlpha } from './color';

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
  startHead: {
    tipX: number;
    tipY: number;
    leftX: number;
    leftY: number;
    rightX: number;
    rightY: number;
  };
  endHead: {
    tipX: number;
    tipY: number;
    leftX: number;
    leftY: number;
    rightX: number;
    rightY: number;
  };
}

function computeArrowGeometry(el: ArrowElement, originX: number, originY: number): ArrowGeometry {
  const { startX, startY, endX, endY } = el;
  const strokeWidth = el.strokeWidth || 1.8;

  // On light grey PDF paper (#F5F5F7), default white/light colors should render as high-contrast dark
  let arrowColor = el.color || '#111827';
  const lower = arrowColor.toLowerCase();
  if (
    lower === '#ffffff' ||
    lower === '#ececec' ||
    lower === '#f3f4f6' ||
    lower === '#fafafa' ||
    lower === 'rgb(236, 236, 236)' ||
    lower === 'white'
  ) {
    arrowColor = '#111827';
  }

  const arrowHeadPosition = el.arrowHeadPosition || 'start';

  const dx = endX - startX;
  const dy = endY - startY;
  const dist = Math.hypot(dx, dy);
  const safeDist = Math.max(dist, 1);

  const nx = -dy / safeDist;
  const ny = dx / safeDist;

  const h = el.controlOffset !== undefined ? el.controlOffset : Math.max(28, Math.min(260, safeDist * 0.28));

  const mx = (startX + endX) / 2;
  const my = (startY + endY) / 2;

  const cx = mx + nx * h;
  const cy = my + ny * h;

  const headLen = 11.5;
  const headWidth = 4.2;

  const hasStartHead = arrowHeadPosition === 'start' || arrowHeadPosition === 'both';
  const hasEndHead = arrowHeadPosition === 'end' || arrowHeadPosition === 'both';

  // Tangent unit vectors for arrowheads pointing towards their respective tips
  const vStartX = startX - cx;
  const vStartY = startY - cy;
  const lenStart = Math.hypot(vStartX, vStartY) || 1;
  const uxStart = vStartX / lenStart;
  const uyStart = vStartY / lenStart;
  const vxStart = -uyStart;
  const vyStart = uxStart;

  const startTipX = startX - originX;
  const startTipY = startY - originY;
  const startBaseX = startTipX - uxStart * headLen;
  const startBaseY = startTipY - uyStart * headLen;
  const startLeftX = startBaseX + vxStart * headWidth;
  const startLeftY = startBaseY + vyStart * headWidth;
  const startRightX = startBaseX - vxStart * headWidth;
  const startRightY = startBaseY - vyStart * headWidth;

  const vEndX = endX - cx;
  const vEndY = endY - cy;
  const lenEnd = Math.hypot(vEndX, vEndY) || 1;
  const uxEnd = vEndX / lenEnd;
  const uyEnd = vEndY / lenEnd;
  const vxEnd = -uyEnd;
  const vyEnd = uxEnd;

  const endTipX = endX - originX;
  const endTipY = endY - originY;
  const endBaseX = endTipX - uxEnd * headLen;
  const endBaseY = endTipY - uyEnd * headLen;
  const endLeftX = endBaseX + vxEnd * headWidth;
  const endLeftY = endBaseY + vyEnd * headWidth;
  const endRightX = endBaseX - vxEnd * headWidth;
  const endRightY = endBaseY - vyEnd * headWidth;

  // Shaft path endpoints recessed inside arrowhead by (headLen - 2.0)
  const pathStartX = hasStartHead ? startTipX - uxStart * (headLen - 2.0) : startX - originX;
  const pathStartY = hasStartHead ? startTipY - uyStart * (headLen - 2.0) : startY - originY;
  const pathEndX = hasEndHead ? endTipX - uxEnd * (headLen - 2.0) : endX - originX;
  const pathEndY = hasEndHead ? endTipY - uyEnd * (headLen - 2.0) : endY - originY;

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

function drawArrowOnCanvas(
  ctx: CanvasRenderingContext2D,
  arrow: ArrowElement,
  originX: number,
  originY: number,
  scale: number
) {
  const geo = computeArrowGeometry(arrow, originX, originY);

  ctx.save();
  ctx.scale(scale, scale);

  // Curved shaft
  ctx.beginPath();
  ctx.moveTo(geo.pathStartX, geo.pathStartY);
  ctx.quadraticCurveTo(geo.cpx, geo.cpy, geo.pathEndX, geo.pathEndY);
  ctx.strokeStyle = geo.arrowColor;
  ctx.lineWidth = geo.strokeWidth;
  ctx.lineCap = 'round';
  ctx.stroke();

  // Arrowhead at Start
  if (geo.arrowHeadPosition === 'start' || geo.arrowHeadPosition === 'both') {
    ctx.beginPath();
    ctx.moveTo(geo.startHead.tipX, geo.startHead.tipY);
    ctx.lineTo(geo.startHead.leftX, geo.startHead.leftY);
    ctx.lineTo(geo.startHead.rightX, geo.startHead.rightY);
    ctx.closePath();
    ctx.fillStyle = geo.arrowColor;
    ctx.fill();
  }

  // Arrowhead at End
  if (geo.arrowHeadPosition === 'end' || geo.arrowHeadPosition === 'both') {
    ctx.beginPath();
    ctx.moveTo(geo.endHead.tipX, geo.endHead.tipY);
    ctx.lineTo(geo.endHead.leftX, geo.endHead.leftY);
    ctx.lineTo(geo.endHead.rightX, geo.endHead.rightY);
    ctx.closePath();
    ctx.fillStyle = geo.arrowColor;
    ctx.fill();
  }

  ctx.restore();
}

/** Pre-rasterize text notes individually into sharp, transparent canvas snippets */
async function rasterizeTextElements(
  textElements: TextElement[]
): Promise<Map<string, { canvas: HTMLCanvasElement; width: number; height: number }>> {
  const map = new Map<string, { canvas: HTMLCanvasElement; width: number; height: number }>();
  if (textElements.length === 0) return map;

  const container = document.createElement('div');
  container.style.position = 'fixed';
  container.style.top = '0';
  container.style.left = '0';
  container.style.pointerEvents = 'none';
  container.style.zIndex = '-9999';
  container.style.opacity = '0';
  document.body.appendChild(container);

  try {
    for (const el of textElements) {
      const card = document.createElement('div');
      card.style.width = `${el.width || 340}px`;
      card.style.padding = '8px 12px';
      card.style.fontFamily = el.fontFamily || 'Comic Sans MS, Comic Neue, cursive, sans-serif';
      card.style.fontSize = `${el.fontSize || 18}px`;

      let textColor = el.color || '#111827';
      const lower = textColor.toLowerCase();
      if (
        lower === '#ffffff' ||
        lower === '#ececec' ||
        lower === '#f3f4f6' ||
        lower === '#fafafa' ||
        lower === 'rgb(236, 236, 236)' ||
        lower === 'white'
      ) {
        textColor = '#111827';
      }
      card.style.color = textColor;
      card.style.fontWeight = el.isBold ? 'bold' : 'normal';
      card.style.lineHeight = '1.6';
      card.style.wordBreak = 'break-word';
      card.innerHTML = el.content;

      container.appendChild(card);

      const opts: any = {
        backgroundColor: null,
        scale: 2,
        logging: false,
      };
      const c = await html2canvas(card, opts);
      const measuredH = Math.max(card.offsetHeight, Math.round(c.height / 2));
      map.set(el.id, {
        canvas: c,
        width: el.width || 340,
        height: measuredH,
      });

      container.removeChild(card);
    }
  } finally {
    if (document.body.contains(container)) {
      document.body.removeChild(container);
    }
  }

  return map;
}

/** Preload all PDF page and attached image elements into memory */
async function preloadImages(
  elements: CanvasElement[]
): Promise<Map<string, HTMLImageElement>> {
  const map = new Map<string, HTMLImageElement>();
  const imageKeys = new Set<string>();
  for (const el of elements) {
    if ((el.type === 'pdf-page' || el.type === 'image') && el.imageKey) {
      imageKeys.add(el.imageKey);
    }
  }

  await Promise.all(
    Array.from(imageKeys).map(async (key) => {
      const url = await getPageImageUrl(key);
      if (!url) return;
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = url;
      await new Promise<void>((resolve) => {
        if (img.complete) resolve();
        else {
          img.onload = () => resolve();
          img.onerror = () => resolve();
        }
      });
      map.set(key, img);
    })
  );

  return map;
}

export async function exportSectionToPdf(
  elements: CanvasElement[],
  notebookName: string,
  sectionName: string
): Promise<void> {
  if (elements.length === 0) {
    alert('Canvas is empty. Add text, images, or PDF pages before exporting.');
    return;
  }

  // 1. Pre-rasterize text elements and pre-load images concurrently
  const textElements = elements.filter((el): el is TextElement => el.type === 'text');
  const [textMap, imageMap] = await Promise.all([
    rasterizeTextElements(textElements),
    preloadImages(elements),
  ]);

  // 2. Find topmost-leftmost corner (minX, minY) and bottommost-rightmost corner (maxX, maxY)
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const el of elements) {
    if (el.type === 'arrow') {
      const dx = el.endX - el.startX;
      const dy = el.endY - el.startY;
      const dist = Math.hypot(dx, dy);
      const safeDist = Math.max(dist, 1);
      const nx = -dy / safeDist;
      const ny = dx / safeDist;
      const h = el.controlOffset !== undefined ? el.controlOffset : Math.max(28, Math.min(260, safeDist * 0.28));
      const cx = (el.startX + el.endX) / 2 + nx * h;
      const cy = (el.startY + el.endY) / 2 + ny * h;

      const minArrowX = Math.min(el.startX, el.endX, cx) - 30;
      const maxArrowX = Math.max(el.startX, el.endX, cx) + 30;
      const minArrowY = Math.min(el.startY, el.endY, cy) - 30;
      const maxArrowY = Math.max(el.startY, el.endY, cy) + 30;
      minX = Math.min(minX, minArrowX);
      minY = Math.min(minY, minArrowY);
      maxX = Math.max(maxX, maxArrowX);
      maxY = Math.max(maxY, maxArrowY);
    } else if (el.type === 'text') {
      const textInfo = textMap.get(el.id);
      const elWidth = el.width || 340;
      const elHeight = textInfo ? textInfo.height : (el.height || 160);
      minX = Math.min(minX, el.x);
      minY = Math.min(minY, el.y);
      maxX = Math.max(maxX, el.x + elWidth);
      maxY = Math.max(maxY, el.y + elHeight);
    } else {
      const elWidth = el.width || 400;
      const elHeight = el.height || 300;
      minX = Math.min(minX, el.x);
      minY = Math.min(minY, el.y);
      maxX = Math.max(maxX, el.x + elWidth);
      maxY = Math.max(maxY, el.y + elHeight);
    }
  }

  // Add 48px margin around all elements
  const margin = 48;
  const contentWidth = Math.max(100, maxX - minX + margin * 2);
  const contentHeight = Math.max(100, maxY - minY + margin * 2);

  // A4 Standard Dimensions (210mm x 297mm, ratio ≈ 1.4142857)
  const A4_ASPECT = 297 / 210;
  const pageCanvasWidth = Math.max(contentWidth, 800);
  const pageCanvasHeight = Math.round(pageCanvasWidth * A4_ASPECT);

  // Center horizontally if content is narrower than page width
  const extraX = pageCanvasWidth > contentWidth ? (pageCanvasWidth - contentWidth) / 2 : 0;
  const pageOriginX = minX - margin - extraX;
  const pageOriginY = minY - margin;

  // Compute number of pages without any artificial limit
  const pageCount = Math.max(1, Math.ceil(contentHeight / pageCanvasHeight));

  // Render resolution per page (crisp 1800px width, well within WebKit canvas limits)
  const renderWidth = Math.min(2400, Math.max(1600, Math.round(pageCanvasWidth * 1.5)));
  const renderHeight = Math.round(renderWidth * A4_ASPECT);
  const scale = renderWidth / pageCanvasWidth;

  // Initialize jsPDF document in portrait A4
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidthMm = 210;
  const pageHeightMm = 297;

  // Sort elements by zIndex so layers stack properly (PDF pages < Images < Arrows < Text)
  const sortedElements = [...elements].sort((a, b) => a.zIndex - b.zIndex);

  // 3. Render each A4 page on its own fresh canvas
  for (let p = 0; p < pageCount; p++) {
    const pageTop = pageOriginY + p * pageCanvasHeight;
    const pageBottom = pageTop + pageCanvasHeight;
    const pageLeft = pageOriginX;

    const pageCanvas = document.createElement('canvas');
    pageCanvas.width = renderWidth;
    pageCanvas.height = renderHeight;
    const ctx = pageCanvas.getContext('2d');
    if (!ctx) continue;

    // Fill page background with subtle light grey (#F5F5F7)
    ctx.fillStyle = '#F5F5F7';
    ctx.fillRect(0, 0, renderWidth, renderHeight);

    // Draw elements overlapping with this page slice
    for (const el of sortedElements) {
      if (el.type === 'pdf-page') {
        const elHeight = el.height || 300;
        if (el.y + elHeight < pageTop || el.y > pageBottom) continue;

        const dx = (el.x - pageLeft) * scale;
        const dy = (el.y - pageTop) * scale;
        const dw = el.width * scale;
        const dh = elHeight * scale;
        const r = 16 * scale;

        // Card background
        ctx.save();
        ctx.beginPath();
        if (typeof ctx.roundRect === 'function') {
          ctx.roundRect(dx, dy, dw, dh, r);
        } else {
          ctx.rect(dx, dy, dw, dh);
        }
        ctx.fillStyle = '#FFFFFF';
        ctx.fill();
        ctx.clip();

        const img = imageMap.get(el.imageKey);
        if (img) {
          ctx.drawImage(img, dx, dy, dw, dh);
        }
        ctx.restore();

        // Subtle border around card
        ctx.save();
        ctx.beginPath();
        if (typeof ctx.roundRect === 'function') {
          ctx.roundRect(dx, dy, dw, dh, r);
        } else {
          ctx.rect(dx, dy, dw, dh);
        }
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.08)';
        ctx.lineWidth = 1 * scale;
        ctx.stroke();
        ctx.restore();
      } else if (el.type === 'image') {
        const elHeight = el.height || 300;
        if (el.y + elHeight < pageTop || el.y > pageBottom) continue;

        const dx = (el.x - pageLeft) * scale;
        const dy = (el.y - pageTop) * scale;
        const dw = el.width * scale;
        const dh = elHeight * scale;
        const r = 12 * scale;

        ctx.save();
        ctx.beginPath();
        if (typeof ctx.roundRect === 'function') {
          ctx.roundRect(dx, dy, dw, dh, r);
        } else {
          ctx.rect(dx, dy, dw, dh);
        }
        ctx.clip();

        const img = imageMap.get(el.imageKey);
        if (img) {
          ctx.drawImage(img, dx, dy, dw, dh);
        }
        ctx.restore();
      } else if (el.type === 'text') {
        const textInfo = textMap.get(el.id);
        const th = textInfo ? textInfo.height : (el.height || 160);
        if (el.y + th < pageTop || el.y > pageBottom) continue;

        const dx = (el.x - pageLeft) * scale;
        const dy = (el.y - pageTop) * scale;
        const dw = (el.width || 340) * scale;
        const dh = th * scale;

        if (textInfo) {
          ctx.drawImage(textInfo.canvas, dx, dy, dw, dh);
        }
      } else if (el.type === 'rect') {
        if (el.y + el.height < pageTop || el.y > pageBottom) continue;

        const dx = (el.x - pageLeft) * scale;
        const dy = (el.y - pageTop) * scale;
        const dw = el.width * scale;
        const dh = el.height * scale;
        const stroke = el.color || '#111827';
        const r = Math.min(el.radius, el.width / 2, el.height / 2) * scale;

        ctx.save();
        ctx.beginPath();
        if (typeof ctx.roundRect === 'function') {
          ctx.roundRect(dx, dy, dw, dh, r);
        } else {
          ctx.rect(dx, dy, dw, dh);
        }
        ctx.fillStyle = withAlpha(stroke, 0.1);
        ctx.fill();
        ctx.strokeStyle = stroke;
        ctx.lineWidth = Math.max(1, el.strokeWidth * scale);
        ctx.stroke();
        ctx.restore();
      } else if (el.type === 'arrow') {
        const dx = el.endX - el.startX;
        const dy = el.endY - el.startY;
        const dist = Math.hypot(dx, dy);
        const safeDist = Math.max(dist, 1);
        const nx = -dy / safeDist;
        const ny = dx / safeDist;
        const h = el.controlOffset !== undefined ? el.controlOffset : Math.max(28, Math.min(260, safeDist * 0.28));
        const cx = (el.startX + el.endX) / 2 + nx * h;
        const cy = (el.startY + el.endY) / 2 + ny * h;

        const minArrowX = Math.min(el.startX, el.endX, cx) - 30;
        const maxArrowX = Math.max(el.startX, el.endX, cx) + 30;
        const minArrowY = Math.min(el.startY, el.endY, cy) - 30;
        const maxArrowY = Math.max(el.startY, el.endY, cy) + 30;
        if (maxArrowX < pageLeft || minArrowX > pageLeft + pageCanvasWidth ||
            maxArrowY < pageTop || minArrowY > pageBottom) continue;

        drawArrowOnCanvas(ctx, el, pageLeft, pageTop, scale);
      }
    }

    // Convert page canvas to high-quality image and add to PDF
    const imgData = pageCanvas.toDataURL('image/jpeg', 0.94);
    if (p > 0) {
      doc.addPage();
    }
    doc.addImage(imgData, 'JPEG', 0, 0, pageWidthMm, pageHeightMm);
  }

  // 4. Save output via native dialog or browser fallback
  const defaultFilename = `${notebookName} — ${sectionName}.pdf`;

  // @ts-expect-error — Tauri check
  const isTauri = typeof window !== 'undefined' && Boolean(window.__TAURI_INTERNALS__);

  if (isTauri) {
    const savePath = await save({
      defaultPath: defaultFilename,
      filters: [{ name: 'PDF Document', extensions: ['pdf'] }],
    });

    if (savePath) {
      const buffer = doc.output('arraybuffer');
      await writeFile(savePath, new Uint8Array(buffer));
      window.dispatchEvent(new CustomEvent('inkwell-toast', { detail: 'PDF exported successfully' }));
    }
  } else {
    doc.save(defaultFilename);
    window.dispatchEvent(new CustomEvent('inkwell-toast', { detail: 'PDF exported successfully' }));
  }
}
