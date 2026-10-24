import html2canvas from 'html2canvas-pro';
import { putPageImage } from '../store/imageStore';
import { PdfPageElement, Viewport } from '../types';

const PAGE_GAP = 40;
const START_OFFSET_Y = 60;
const JPEG_QUALITY = 0.85;

interface ImportGeometry {
  viewport: Viewport;
  containerRect: { width: number; height: number };
}

interface RenderedPage {
  node: HTMLElement;
  width: number;
  height: number;
}

/** Wait for images and fonts inside a rendered page before rasterizing it. */
async function waitForPageAssets(node: HTMLElement) {
  if (document.fonts?.ready) {
    await document.fonts.ready.catch(() => {});
  }

  const images = Array.from(node.querySelectorAll('img'));
  await Promise.all(
    images.map(
      (img) =>
        new Promise<void>((resolve) => {
          if (img.complete) {
            resolve();
            return;
          }
          const done = () => resolve();
          img.addEventListener('load', done, { once: true });
          img.addEventListener('error', done, { once: true });
          // Never block an import indefinitely on a broken asset.
          window.setTimeout(done, 3000);
        })
    )
  );
}

async function rasterizePage(node: HTMLElement): Promise<Blob> {
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  const scale = Math.min(2, Math.max(1.5, dpr));

  const canvas = await html2canvas(node, {
    backgroundColor: '#ffffff',
    scale,
    logging: false,
    useCORS: true,
  });

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => {
        if (b) resolve(b);
        else reject(new Error('Failed to convert imported page to an image'));
      },
      'image/jpeg',
      JPEG_QUALITY
    );
  });

  canvas.width = 0;
  canvas.height = 0;
  return blob;
}

/**
 * Places rendered document pages on the canvas in the same vertical stack the
 * PDF importer uses, storing each rasterized page in IndexedDB.
 */
async function pagesToElements(
  pages: RenderedPage[],
  fileName: string,
  geometry: ImportGeometry,
  onProgress?: (done: number, total: number) => void
): Promise<PdfPageElement[]> {
  const totalPages = pages.length;
  if (totalPages === 0) {
    throw new Error('No pages found in this document');
  }

  const screenCenterX = geometry.containerRect.width / 2;
  const screenCenterY = geometry.containerRect.height / 2;
  const canvasCenterX = (screenCenterX - geometry.viewport.x) / geometry.viewport.zoom;
  const canvasCenterY = (screenCenterY - geometry.viewport.y) / geometry.viewport.zoom;

  const documentId = crypto.randomUUID();
  const elements: PdfPageElement[] = [];
  let currentY = canvasCenterY + START_OFFSET_Y;

  for (let index = 0; index < pages.length; index++) {
    const pageNumber = index + 1;
    onProgress?.(pageNumber, totalPages);

    const { node, width, height } = pages[index];
    await waitForPageAssets(node);
    const blob = await rasterizePage(node);

    const imageKey = `page:${documentId}:${pageNumber}`;
    await putPageImage(imageKey, blob);

    elements.push({
      id: crypto.randomUUID(),
      type: 'pdf-page',
      pdfId: documentId,
      pdfName: fileName,
      pageNumber,
      totalPages,
      x: Math.round(canvasCenterX - width / 2),
      y: Math.round(currentY),
      width,
      height,
      imageKey,
      isLocked: false,
      zIndex: pageNumber,
    });

    currentY += height + PAGE_GAP;
  }

  return elements;
}

/** Render a .docx file into page images and insertable canvas elements. */
export async function processDocxFile(
  file: File,
  viewport: Viewport,
  containerRect: { width: number; height: number },
  onProgress?: (done: number, total: number) => void
): Promise<PdfPageElement[]> {
  const host = document.createElement('div');
  host.style.cssText =
    'position: fixed; left: -10000px; top: 0; width: 900px; background: #ffffff; z-index: -1;';
  document.body.appendChild(host);

  try {
    const { renderAsync } = await import('docx-preview');
    await renderAsync(file, host, host, {
      className: 'docx',
      inWrapper: true,
      ignoreWidth: false,
      ignoreHeight: false,
      ignoreFonts: false,
      breakPages: true,
      renderHeaders: true,
      renderFooters: true,
      renderFootnotes: true,
      renderEndnotes: true,
      useBase64URL: true,
    });

    const sections = Array.from(host.querySelectorAll<HTMLElement>('section.docx'));
    const pages: RenderedPage[] = sections.map((node) => {
      const rect = node.getBoundingClientRect();
      return {
        node,
        width: Math.max(1, Math.round(rect.width || node.offsetWidth)),
        height: Math.max(1, Math.round(rect.height || node.offsetHeight)),
      };
    });

    return await pagesToElements(pages, file.name, { viewport, containerRect }, onProgress);
  } finally {
    host.remove();
  }
}

/** Render a .pptx file as one image per slide. */
export async function processPptxFile(
  file: File,
  viewport: Viewport,
  containerRect: { width: number; height: number },
  onProgress?: (done: number, total: number) => void
): Promise<PdfPageElement[]> {
  const host = document.createElement('div');
  host.style.cssText =
    'position: fixed; left: -10000px; top: 0; background: #ffffff; z-index: -1;';
  document.body.appendChild(host);

  let previewer: {
    preview: (file: ArrayBuffer) => Promise<unknown>;
    destroy: () => void;
  } | null = null;

  try {
    const { init: initPptxPreview } = await import('pptx-preview');
    previewer = initPptxPreview(host, {
      width: 1280,
      height: 720,
      mode: 'list',
    });

    const buffer = await file.arrayBuffer();
    await previewer.preview(buffer);

    const slideNodes = Array.from(
      host.querySelectorAll<HTMLElement>('.pptx-preview-slide-wrapper')
    );

    const pages: RenderedPage[] = slideNodes.map((node) => {
      const rect = node.getBoundingClientRect();
      return {
        node,
        width: Math.max(1, Math.round(rect.width || node.offsetWidth)),
        height: Math.max(1, Math.round(rect.height || node.offsetHeight)),
      };
    });

    return await pagesToElements(pages, file.name, { viewport, containerRect }, onProgress);
  } finally {
    try {
      previewer?.destroy();
    } catch {
      // Ignore teardown errors from the third-party previewer.
    }
    host.remove();
  }
}

/** File extensions the importer understands. */
export function getDocumentExtension(fileName: string): string {
  return fileName.split('.').pop()?.toLowerCase() ?? '';
}
