import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';
import { putPageImage } from '../store/imageStore';
import { PdfPageElement, Viewport } from '../types';

// §10 P4: Set GlobalWorkerOptions at module scope before getDocument
pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

export async function processPdfFile(
  file: File,
  currentViewport: Viewport,
  containerRect: { width: number; height: number },
  onProgress?: (done: number, total: number) => void
): Promise<PdfPageElement[]> {
  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(arrayBuffer),
  });
  const pdf = await loadingTask.promise;
  const totalPages = pdf.numPages;
  const pdfId = crypto.randomUUID();

  // Screen center to canvas center
  const screenCenterX = containerRect.width / 2;
  const screenCenterY = containerRect.height / 2;
  const canvasCenterX = (screenCenterX - currentViewport.x) / currentViewport.zoom;
  const canvasCenterY = (screenCenterY - currentViewport.y) / currentViewport.zoom;

  const pages: PdfPageElement[] = [];
  // §9.2: Stack starting 60px below center
  let currentY = canvasCenterY + 60;

  for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
    onProgress?.(pageNum, totalPages);
    const page = await pdf.getPage(pageNum);

    // Unscaled viewport for card size in canvas space (scale: 1)
    const baseViewport = page.getViewport({ scale: 1 });
    const cardWidth = baseViewport.width;
    const cardHeight = baseViewport.height;

    // High DPI rasterization per §9.2
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    const rasterScale = 1.5 * Math.min(dpr, 2);
    const renderViewport = page.getViewport({ scale: rasterScale });

    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(renderViewport.width);
    canvas.height = Math.floor(renderViewport.height);
    const ctx = canvas.getContext('2d');

    if (!ctx) throw new Error('Could not get canvas context');

    // Render page
    const renderContext = {
      canvasContext: ctx,
      viewport: renderViewport,
    };
    // @ts-expect-error — pdfjs-dist v5 types
    await page.render(renderContext).promise;

    // §7: Rasterize to JPEG quality 0.82
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => {
          if (b) resolve(b);
          else reject(new Error('Failed to convert canvas to JPEG blob'));
        },
        'image/jpeg',
        0.82
      );
    });

    const imageKey = `page:${pdfId}:${pageNum}`;
    await putPageImage(imageKey, blob);

    // Clean up canvas
    canvas.width = 0;
    canvas.height = 0;

    // Center horizontally
    const pageX = canvasCenterX - cardWidth / 2;
    const pageY = currentY;

    pages.push({
      id: crypto.randomUUID(),
      type: 'pdf-page',
      pdfId,
      pdfName: file.name,
      pageNumber: pageNum,
      totalPages,
      x: pageX,
      y: pageY,
      width: cardWidth,
      height: cardHeight,
      imageKey,
      isLocked: false,
      zIndex: pageNum,
    });

    // 40px gutter
    currentY += cardHeight + 40;
  }

  return pages;
}
