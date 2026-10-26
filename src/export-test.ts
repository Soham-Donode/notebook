import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';
import { exportSectionToPdf } from './utils/exportPdf';
import { putPageImage } from './store/imageStore';
import type { CanvasElement, TextElement } from './types';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

const CARD_W = 792;
const CARD_H = 612;

function makeSlide(index: number): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  ctx.strokeStyle = '#111827';
  ctx.lineWidth = 10;
  ctx.strokeRect(20, 20, CARD_W - 40, CARD_H - 40);
  ctx.fillStyle = '#111827';
  ctx.font = '700 84px Helvetica, Arial, sans-serif';
  ctx.fillText(`SLIDE ${index}`, 70, 160);
  ctx.font = '400 34px Helvetica, Arial, sans-serif';
  for (let line = 0; line < 4; line++) {
    ctx.fillText(`Body line ${line + 1} of lecture content`, 70, 260 + line * 60);
  }
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('blob failed'))), 'image/jpeg', 0.92);
  });
}

async function buildIvpElements(): Promise<CanvasElement[]> {
  const elements: CanvasElement[] = [
    {
      id: 'note-ivp',
      type: 'text',
      x: 195.1294924350512,
      y: 277.95906229680827,
      width: 525,
      height: null,
      zIndex: 0,
      fontFamily: 'inherit',
      fontSize: 18,
      content:
        '<p>Ill be giving you some slides and questions your task is to explain them very comprehensively and clearly do not assume anything.</p>',
    } as TextElement,
  ];

  for (let index = 1; index <= 26; index++) {
    const key = `test:ivp:${index}`;
    await putPageImage(key, await makeSlide(index));
    elements.push({
      id: `ivp-page-${index}`,
      type: 'pdf-page',
      x: 199,
      y: 522 + (index - 1) * 652,
      width: CARD_W,
      height: CARD_H,
      zIndex: index,
      imageKey: key,
      pdfId: 'test:ivp',
      pdfName: 'chapter1.pdf',
      pageNumber: index,
      totalPages: 26,
      isLocked: true,
    });
  }

  return elements;
}

async function analyze(buffer: ArrayBuffer) {
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;
  const pages = [];

  for (let index = 1; index <= pdf.numPages; index++) {
    const page = await pdf.getPage(index);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: 420 / base.width });
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport, canvas } as never).promise;

    const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    let dark = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const offset = (y * width + x) * 4;
        const lum =
          (0.2126 * data[offset] + 0.7152 * data[offset + 1] + 0.0722 * data[offset + 2]) / 255;
        if (lum < 0.55) {
          dark++;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }

    pages.push({
      page: index,
      orientation: base.width > base.height ? 'landscape' : 'portrait',
      bbox:
        maxX < 0
          ? null
          : {
              x: +(minX / width).toFixed(3),
              y: +(minY / height).toFixed(3),
              w: +((maxX - minX + 1) / width).toFixed(3),
              h: +((maxY - minY + 1) / height).toFixed(3),
            },
      dark: +(dark / (width * height)).toFixed(4),
    });
    page.cleanup();
  }

  return { pages: pdf.numPages, orientation: pages[0]?.orientation, detail: pages };
}

async function captureDownload(run: () => Promise<unknown>) {
  let blob: Blob | null = null;
  const originalCreate = URL.createObjectURL;
  URL.createObjectURL = function (this: typeof URL, object: Blob | MediaSource) {
    if (!blob && object instanceof Blob && object.type === 'application/pdf') blob = object;
    return originalCreate.call(this, object);
  };

  try {
    const result = await run();
    if (!blob) return { result, error: 'no pdf blob captured' };
    return { result, analysis: await analyze(await (blob as Blob).arrayBuffer()) };
  } finally {
    URL.createObjectURL = originalCreate;
  }
}

async function runTest(mode: 'auto' | 'portrait' | 'landscape' | 'abort' = 'auto') {
  const elements = await buildIvpElements();
  const common = { paper: 'a4' as const, includeHeader: true, includePageNumbers: true };

  if (mode === 'abort') {
    const controller = new AbortController();
    const promise = exportSectionToPdf(elements, 'IVP Test', 'Lecture 1', {
      ...common,
      orientation: 'auto',
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 400);
    try {
      await promise;
      return { abortWorked: false };
    } catch (error) {
      return { abortWorked: (error as Error).name === 'PdfExportCancelled' };
    }
  }

  const started = performance.now();
  const outcome = await captureDownload(() =>
    exportSectionToPdf(elements, 'IVP Test', 'Lecture 1', { ...common, orientation: mode })
  );
  return {
    mode,
    ms: Math.round(performance.now() - started),
    ...outcome,
  };
}

(window as unknown as { runTest: typeof runTest }).runTest = runTest;
