import { invoke } from '@tauri-apps/api/core';
import { PdfPageElement, Viewport } from '../types';
import { processPdfFile } from './pdfProcessor';

/**
 * Imports a .ppt/.pptx by first converting it to PDF natively (PowerPoint on
 * Windows, LibreOffice as fallback — see `convert_ppt_to_pdf` in lib.rs), then
 * running the regular PDF pipeline so slides become normal page cards.
 */
export async function processPptFile(
  file: File,
  currentViewport: Viewport,
  containerRect: { width: number; height: number },
  onProgress?: (done: number, total: number) => void
): Promise<PdfPageElement[]> {
  if (!('__TAURI_INTERNALS__' in window)) {
    throw new Error('Presentation import requires the desktop app.');
  }

  const ext = file.name.toLowerCase().endsWith('.ppt') ? 'ppt' : 'pptx';
  const pdfBytes = await invoke<ArrayBuffer>(
    'convert_ppt_to_pdf',
    new Uint8Array(await file.arrayBuffer()),
    { headers: { 'x-ext': ext } }
  );

  const pdfFile = new File([pdfBytes], file.name.replace(/\.pptx?$/i, '') + '.pdf', {
    type: 'application/pdf',
  });
  return processPdfFile(pdfFile, currentViewport, containerRect, onProgress);
}
