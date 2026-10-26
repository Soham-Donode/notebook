/**
 * Portable `.notebook` archives.
 *
 * A `.notebook` file is a ZIP of the same layout used on disk:
 *
 *   manifest.json          format/version + old image key -> archive path
 *   notebook.json          the Notebook object (local folder fields stripped)
 *   images/<safe-key>.jpg  raw image/PDF-page bytes
 *
 * Exporting never mutates local state. Importing regenerates every id and
 * image key so that two copies of the same archive can be deleted independently.
 */

import {
  strFromU8,
  strToU8,
  unzip,
  zip,
  type Unzipped,
  type Zippable,
} from 'fflate';
import { open, save } from '@tauri-apps/plugin-dialog';
import { readFile, writeFile } from '@tauri-apps/plugin-fs';
import { type CanvasElement, type Notebook, type Section, SCHEMA_VERSION } from '../types';
import { cachePageImage, getPageBlob } from '../store/imageStore';
import { useNotesStore } from '../store/useNotesStore';
import {
  deleteNotebookFromDisk,
  findAvailableNotebookTarget,
  isTauriEnvironment,
  sanitizeFolderName,
  sanitizeKey,
  saveImageToDisk,
  saveNotebookToDisk,
} from '../services/storageService';

const ARCHIVE_FORMAT = 'notebook';
const NOTEBOOK_ENTRY = 'notebook.json';
const MANIFEST_ENTRY = 'manifest.json';
const KNOWN_ELEMENT_TYPES = new Set<CanvasElement['type']>([
  'text',
  'pdf-page',
  'image',
  'arrow',
  'rect',
]);

interface NotebookArchiveManifest {
  format: typeof ARCHIVE_FORMAT;
  version: number;
  exportedAt: string;
  notebook: { id: string; name: string };
  /** Original image key -> path inside the archive. */
  images: Record<string, string>;
}

export interface NotebookExportResult {
  /** False when the user dismissed the save dialog. */
  saved: boolean;
  imageCount: number;
  missingImages: number;
  path?: string;
}

export interface NotebookImportResult {
  notebook: Notebook;
  folder: string | null;
  imageCount: number;
  missingImages: number;
}

function zipAsync(files: Zippable): Promise<Uint8Array<ArrayBuffer>> {
  return new Promise((resolve, reject) => {
    zip(files, { level: 6 }, (error, data) => {
      if (error) reject(error);
      else resolve(data);
    });
  });
}

function unzipAsync(data: Uint8Array): Promise<Unzipped> {
  return new Promise((resolve, reject) => {
    unzip(data, (error, files) => {
      if (error) reject(error);
      else resolve(files);
    });
  });
}

function safeMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return String(error);
}

function cloneNotebook(notebook: Notebook): Notebook {
  return JSON.parse(JSON.stringify(notebook)) as Notebook;
}

function collectImageKeys(notebook: Notebook): string[] {
  const keys = new Set<string>();
  for (const section of notebook.sections) {
    for (const element of section.elements) {
      if (
        (element.type === 'pdf-page' || element.type === 'image') &&
        typeof element.imageKey === 'string' &&
        element.imageKey
      ) {
        keys.add(element.imageKey);
      }
    }
  }
  return [...keys];
}

function createArchiveImagePath(key: string, used: Set<string>): string {
  const stem = sanitizeKey(key);
  let path = `images/${stem}.jpg`;
  let suffix = 2;
  while (used.has(path)) {
    path = `images/${stem}-${suffix}.jpg`;
    suffix += 1;
  }
  used.add(path);
  return path;
}

function normaliseArchivePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.?\//, '');
}

function findEntry(files: Unzipped, path: string): Uint8Array<ArrayBuffer> | undefined {
  const wanted = normaliseArchivePath(path);
  const exact = files[wanted];
  if (exact) return exact;

  // Tolerate archives that wrap everything in a single top-level folder.
  const match = Object.keys(files).find((name) => {
    const normalised = normaliseArchivePath(name);
    return normalised === wanted || normalised.endsWith(`/${wanted}`);
  });
  return match ? files[match] : undefined;
}

function parseArchiveNotebook(files: Unzipped): Notebook {
  const bytes = findEntry(files, NOTEBOOK_ENTRY);
  if (!bytes) {
    throw new Error('This file is not a Notebook archive — notebook.json is missing.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(strFromU8(bytes));
  } catch {
    throw new Error('The notebook data inside this archive is not valid JSON.');
  }

  return normaliseImportedNotebook(parsed);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normaliseImportedNotebook(value: unknown): Notebook {
  if (!isRecord(value)) {
    throw new Error('The notebook data inside this archive is incomplete.');
  }

  const rawSections = Array.isArray(value.sections) ? value.sections : [];
  const sections: Section[] = rawSections
    .filter(isRecord)
    .map((rawSection) => {
      const viewport = isRecord(rawSection.viewport) ? rawSection.viewport : {};
      return {
        id: typeof rawSection.id === 'string' && rawSection.id ? rawSection.id : crypto.randomUUID(),
        name:
          typeof rawSection.name === 'string' && rawSection.name.trim()
            ? rawSection.name
            : 'Untitled Section',
        viewport: {
          x: typeof viewport.x === 'number' && Number.isFinite(viewport.x) ? viewport.x : 0,
          y: typeof viewport.y === 'number' && Number.isFinite(viewport.y) ? viewport.y : 0,
          zoom:
            typeof viewport.zoom === 'number' && Number.isFinite(viewport.zoom) && viewport.zoom > 0
              ? viewport.zoom
              : 1,
        },
        elements: Array.isArray(rawSection.elements)
          ? rawSection.elements.filter(
              (element): element is CanvasElement =>
                isRecord(element) &&
                KNOWN_ELEMENT_TYPES.has(element.type as CanvasElement['type']) &&
                typeof element.x === 'number' &&
                Number.isFinite(element.x) &&
                typeof element.y === 'number' &&
                Number.isFinite(element.y) &&
                ((element.type !== 'pdf-page' && element.type !== 'image') ||
                  (typeof element.imageKey === 'string' && element.imageKey.length > 0))
            )
          : [],
      };
    });

  if (sections.length === 0) {
    sections.push({
      id: crypto.randomUUID(),
      name: 'Section 1',
      viewport: { x: 0, y: 0, zoom: 1 },
      elements: [],
    });
  }

  return {
    id: typeof value.id === 'string' && value.id ? value.id : crypto.randomUUID(),
    name:
      typeof value.name === 'string' && value.name.trim()
        ? value.name.trim()
        : 'Imported Notebook',
    createdAt:
      typeof value.createdAt === 'number' && Number.isFinite(value.createdAt)
        ? value.createdAt
        : Date.now(),
    updatedAt:
      typeof value.updatedAt === 'number' && Number.isFinite(value.updatedAt)
        ? value.updatedAt
        : Date.now(),
    sections,
  };
}

function parseManifest(files: Unzipped): NotebookArchiveManifest | null {
  const bytes = findEntry(files, MANIFEST_ENTRY);
  if (!bytes) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(strFromU8(bytes));
  } catch {
    throw new Error('The archive manifest is damaged.');
  }

  if (!isRecord(parsed)) {
    throw new Error('The archive manifest is damaged.');
  }

  if (parsed.format !== undefined && parsed.format !== ARCHIVE_FORMAT) {
    throw new Error('This ZIP is not a Notebook archive.');
  }

  const version = typeof parsed.version === 'number' ? parsed.version : SCHEMA_VERSION;
  if (version > SCHEMA_VERSION) {
    throw new Error(
      `This notebook was exported by a newer version of Notebook (format ${version}). Update the app to import it.`
    );
  }

  const images: Record<string, string> = {};
  if (isRecord(parsed.images)) {
    for (const [key, path] of Object.entries(parsed.images)) {
      if (typeof path === 'string' && path) {
        images[key] = path;
      }
    }
  }

  return {
    format: ARCHIVE_FORMAT,
    version,
    exportedAt:
      typeof parsed.exportedAt === 'string' ? parsed.exportedAt : new Date(0).toISOString(),
    notebook: isRecord(parsed.notebook)
      ? {
          id: typeof parsed.notebook.id === 'string' ? parsed.notebook.id : '',
          name: typeof parsed.notebook.name === 'string' ? parsed.notebook.name : '',
        }
      : { id: '', name: '' },
    images,
  };
}

function findArchiveImage(
  files: Unzipped,
  manifest: NotebookArchiveManifest | null,
  key: string
): Uint8Array<ArrayBuffer> | undefined {
  const manifestPath = manifest?.images[key];
  if (manifestPath && normaliseArchivePath(manifestPath).startsWith('images/')) {
    const fromManifest = findEntry(files, manifestPath);
    if (fromManifest) return fromManifest;
  }

  const expected = `images/${sanitizeKey(key)}.jpg`;
  const direct = findEntry(files, expected);
  if (direct) return direct;

  const stem = `images/${sanitizeKey(key)}.`;
  const match = Object.keys(files).find((name) => {
    const normalised = normaliseArchivePath(name);
    return normalised.includes(stem) && !normalised.endsWith('/');
  });
  return match ? files[match] : undefined;
}

function newImageKey(oldKey: string): string {
  if (oldKey.startsWith('img:')) return `img:${crypto.randomUUID()}`;
  return `page:${crypto.randomUUID()}`;
}

function regenerateNotebookIds(notebook: Notebook): {
  notebook: Notebook;
  imageKeyMap: Map<string, string>;
} {
  const imageKeyMap = new Map<string, string>();
  const pdfIdMap = new Map<string, string>();

  const sections = notebook.sections.map((section) => ({
    ...section,
    id: crypto.randomUUID(),
    elements: section.elements.map((element) => {
      const next = {
        ...element,
        id: crypto.randomUUID(),
      } as CanvasElement;

      if (next.type === 'pdf-page' || next.type === 'image') {
        if (typeof next.imageKey === 'string' && next.imageKey) {
          let mapped = imageKeyMap.get(next.imageKey);
          if (!mapped) {
            mapped = newImageKey(next.imageKey);
            imageKeyMap.set(next.imageKey, mapped);
          }
          next.imageKey = mapped;
        }

        if (next.type === 'pdf-page') {
          const oldPdfId = typeof next.pdfId === 'string' ? next.pdfId : '';
          let mappedPdfId = pdfIdMap.get(oldPdfId);
          if (!mappedPdfId) {
            mappedPdfId = crypto.randomUUID();
            pdfIdMap.set(oldPdfId, mappedPdfId);
          }
          next.pdfId = mappedPdfId;
        }
      }

      return next;
    }),
  }));

  return {
    notebook: {
      ...notebook,
      id: crypto.randomUUID(),
      sections,
    },
    imageKeyMap,
  };
}

function downloadArchive(bytes: Uint8Array, filename: string) {
  const blob = new Blob([new Uint8Array(bytes)], { type: 'application/zip' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Give the browser a moment to start the download before releasing the URL.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Packs a notebook into a `.notebook` ZIP. Opens the native save dialog in
 * Tauri and falls back to a browser download during `npm run dev`.
 */
export async function exportNotebookArchive(notebook: Notebook): Promise<NotebookExportResult> {
  const tauri = isTauriEnvironment();
  const filename = `${sanitizeFolderName(notebook.name)}.notebook`;

  // Ask where to save before packing, so cancelling does not cost any work.
  let targetPath: string | null = null;
  if (tauri) {
    const target = await save({
      title: 'Export notebook',
      defaultPath: filename,
      filters: [{ name: 'Notebook archive', extensions: ['notebook'] }],
    });
    if (!target) {
      return { saved: false, imageCount: 0, missingImages: 0 };
    }
    targetPath = target.toLowerCase().endsWith('.notebook') ? target : `${target}.notebook`;
  }

  const exportedNotebook = cloneNotebook(notebook);
  delete exportedNotebook.folderName;
  delete exportedNotebook.folderPath;
  // Imported copies get fresh dates from the importer; exports keep their history.
  exportedNotebook.updatedAt = Date.now();

  const imageKeys = collectImageKeys(exportedNotebook);
  const usedPaths = new Set<string>();
  const imagePaths = new Map<string, string>();
  const files: Zippable = {};
  let missingImages = 0;

  for (const key of imageKeys) {
    const blob = await getPageBlob(key).catch(() => null);
    if (!blob) {
      missingImages += 1;
      continue;
    }

    const path = createArchiveImagePath(key, usedPaths);
    imagePaths.set(key, path);
    files[path] = [new Uint8Array(await blob.arrayBuffer()), { level: 0 }];
  }

  const manifest: NotebookArchiveManifest = {
    format: ARCHIVE_FORMAT,
    version: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    notebook: { id: exportedNotebook.id, name: exportedNotebook.name },
    images: Object.fromEntries(imagePaths),
  };

  files[MANIFEST_ENTRY] = [
    strToU8(JSON.stringify(manifest, null, 2)),
    { level: 6 },
  ];
  files[NOTEBOOK_ENTRY] = [
    strToU8(JSON.stringify(exportedNotebook, null, 2)),
    { level: 6 },
  ];

  const bytes = await zipAsync(files);

  if (!tauri || !targetPath) {
    downloadArchive(bytes, filename);
    return {
      saved: true,
      imageCount: imagePaths.size,
      missingImages,
    };
  }

  await writeFile(targetPath, bytes);
  return {
    saved: true,
    imageCount: imagePaths.size,
    missingImages,
    path: targetPath,
  };
}

async function readArchiveForImport(
  source?: File | string | Uint8Array
): Promise<{ bytes: Uint8Array } | null> {
  if (source instanceof Uint8Array) {
    return { bytes: source };
  }

  if (typeof source === 'string') {
    return { bytes: await readFile(source) };
  }

  if (typeof File !== 'undefined' && source instanceof File) {
    return { bytes: new Uint8Array(await source.arrayBuffer()) };
  }

  if (!isTauriEnvironment()) {
    throw new Error('Choose a .notebook file to import.');
  }

  const selected = await open({
    title: 'Import notebook',
    multiple: false,
    directory: false,
    filters: [{ name: 'Notebook archive', extensions: ['notebook'] }],
  });

  if (!selected || Array.isArray(selected)) return null;

  return { bytes: await readFile(selected) };
}

/**
 * Unpacks and imports a `.notebook` archive. In Tauri, opens the native file
 * picker when no source is supplied. Returns `null` when the picker is
 * dismissed. The notebook is written into its own folder under
 * ~/Documents/Notebook and is ready to be added to the store.
 */
export async function importNotebookArchive(
  source?: File | string | Uint8Array
): Promise<NotebookImportResult | null> {
  let archive: { bytes: Uint8Array } | null;
  try {
    archive = await readArchiveForImport(source);
  } catch (error) {
    throw new Error(`Could not open the archive: ${safeMessage(error)}`);
  }
  if (!archive) return null;

  let files: Unzipped;
  try {
    files = await unzipAsync(archive.bytes);
  } catch {
    throw new Error('This file is not a valid .notebook archive.');
  }

  const manifest = parseManifest(files);
  const notebookData = parseArchiveNotebook(files);
  const { notebook, imageKeyMap } = regenerateNotebookIds(notebookData);
  const existingNotebooks = useNotesStore.getState().notebooks;
  const target = await findAvailableNotebookTarget(notebookData.name, existingNotebooks);

  let imageCount = 0;
  let missingImages = 0;
  const blobs = new Map<string, Blob>();

  for (const [oldKey, newKey] of imageKeyMap) {
    const bytes = findArchiveImage(files, manifest, oldKey);
    if (!bytes) {
      missingImages += 1;
      continue;
    }

    const blob = new Blob([bytes], { type: 'image/jpeg' });
    blobs.set(newKey, blob);
  }

  const importedNotebook: Notebook = {
    ...notebook,
    name: target.name,
    folderName: target.folder,
    createdAt: notebook.createdAt || Date.now(),
    updatedAt: Date.now(),
  };
  delete importedNotebook.folderPath;

  const tauri = isTauriEnvironment();

  try {
    if (tauri) {
      for (const [key, blob] of blobs) {
        const written = await saveImageToDisk(key, blob, target.folder);
        if (!written) {
          throw new Error('Could not write the notebook images to Documents.');
        }
        imageCount += 1;
      }

      const saved = await saveNotebookToDisk(importedNotebook);
      if (!saved) {
        throw new Error('Could not write the notebook to Documents.');
      }
    } else {
      imageCount = blobs.size;
    }

    for (const [key, blob] of blobs) {
      await cachePageImage(key, blob);
    }
  } catch (error) {
    if (tauri) {
      await deleteNotebookFromDisk(importedNotebook);
    }
    throw new Error(`Import failed: ${safeMessage(error)}`);
  }

  return {
    notebook: importedNotebook,
    folder: tauri ? target.folder : null,
    imageCount,
    missingImages,
  };
}
