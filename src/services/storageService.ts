import {
  BaseDirectory,
  mkdir,
  exists,
  readFile,
  writeFile,
  remove,
  readDir,
} from '@tauri-apps/plugin-fs';
import { Notebook } from '../types';

const ROOT_DIR = 'Notebook';
const IMAGES_DIR = 'Notebook/images';

export function isTauriEnvironment(): boolean {
  return typeof window !== 'undefined' && Boolean((window as any).__TAURI_INTERNALS__);
}

export function sanitizeFolderName(name: string): string {
  // Replace filesystem reserved characters: / \ : * ? " < > |
  const cleaned = name.trim().replace(/[/\\:*?"<>|]/g, '_');
  return cleaned || 'Untitled_Notebook';
}

export function getNotebookFolderName(notebook: { name: string; folderName?: string }): string {
  if (notebook.folderName && notebook.folderName.trim()) {
    return sanitizeFolderName(notebook.folderName);
  }
  return sanitizeFolderName(notebook.name);
}

export function sanitizeKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9_-]/g, '_');
}

export interface AvailableNotebookTarget {
  name: string;
  folder: string;
}

/**
 * Picks a display name and disk folder that neither the in-memory notebook list
 * nor ~/Documents/Notebook already uses. Importing the same archive twice should
 * produce two independently deletable notebooks, not overwrite the first copy.
 */
export async function findAvailableNotebookTarget(
  preferredName: string,
  existing: ReadonlyArray<{ name: string; folderName?: string }>
): Promise<AvailableNotebookTarget> {
  const base = preferredName.trim() || 'Untitled Notebook';
  const takenNames = new Set(
    existing.map((notebook) => notebook.name.trim().toLowerCase()).filter(Boolean)
  );
  const takenFolders = new Set(
    existing.map((notebook) => getNotebookFolderName(notebook).toLowerCase())
  );

  for (let index = 1; index < 1000; index++) {
    const name = index === 1 ? base : `${base} (${index})`;
    const folder = sanitizeFolderName(name);
    if (takenNames.has(name.toLowerCase()) || takenFolders.has(folder.toLowerCase())) {
      continue;
    }

    if (isTauriEnvironment()) {
      try {
        if (await exists(`${ROOT_DIR}/${folder}`, { baseDir: BaseDirectory.Document })) {
          continue;
        }
      } catch {
        // Never risk overwriting a folder we could not inspect.
        break;
      }
    }

    return { name, folder };
  }

  const fallbackName = `${base} ${Date.now()}`;
  return { name: fallbackName, folder: sanitizeFolderName(fallbackName) };
}

/**
 * Initializes the ~/Documents/Notebook root directory.
 */
export async function initDocumentsStorage(): Promise<boolean> {
  if (!isTauriEnvironment()) {
    return false;
  }

  try {
    const rootExists = await exists(ROOT_DIR, { baseDir: BaseDirectory.Document });
    if (!rootExists) {
      await mkdir(ROOT_DIR, { baseDir: BaseDirectory.Document, recursive: true });
    }
    return true;
  } catch (err) {
    console.error('[StorageService] Failed to init documents storage:', err);
    return false;
  }
}

/**
 * Migrates legacy monolithic Notebook/notebooks.json and Notebook/images/
 * into isolated per-notebook folders (Notebook/<Name>/notebook.json & Notebook/<Name>/images/).
 */
async function migrateLegacyStorageIfPresent(): Promise<void> {
  if (!isTauriEnvironment()) return;

  try {
    const legacyJsonPath = `${ROOT_DIR}/notebooks.json`;
    const hasLegacyJson = await exists(legacyJsonPath, { baseDir: BaseDirectory.Document });
    if (!hasLegacyJson) return;

    console.log('[StorageService] Found legacy notebooks.json, migrating to per-notebook folders...');
    const bytes = await readFile(legacyJsonPath, { baseDir: BaseDirectory.Document });
    const raw = new TextDecoder().decode(bytes);
    const parsed = JSON.parse(raw);

    if (parsed && Array.isArray(parsed.notebooks)) {
      for (const nb of parsed.notebooks as Notebook[]) {
        const folder = getNotebookFolderName(nb);
        const nbDir = `${ROOT_DIR}/${folder}`;
        const imgDir = `${nbDir}/images`;

        if (!(await exists(nbDir, { baseDir: BaseDirectory.Document }))) {
          await mkdir(nbDir, { baseDir: BaseDirectory.Document, recursive: true });
        }
        if (!(await exists(imgDir, { baseDir: BaseDirectory.Document }))) {
          await mkdir(imgDir, { baseDir: BaseDirectory.Document, recursive: true });
        }

        // Write notebook.json
        const nbData = JSON.stringify(nb, null, 2);
        await writeFile(`${nbDir}/notebook.json`, new TextEncoder().encode(nbData), { baseDir: BaseDirectory.Document });

        // Copy all images referenced by this notebook from legacy images/ to new folder
        for (const sec of nb.sections) {
          for (const el of sec.elements) {
            if ((el.type === 'pdf-page' || el.type === 'image') && el.imageKey) {
              const safeKey = sanitizeKey(el.imageKey);
              const oldImgPath = `${IMAGES_DIR}/${safeKey}.jpg`;
              const newImgPath = `${imgDir}/${safeKey}.jpg`;

              try {
                if (await exists(oldImgPath, { baseDir: BaseDirectory.Document })) {
                  if (!(await exists(newImgPath, { baseDir: BaseDirectory.Document }))) {
                    const imgBytes = await readFile(oldImgPath, { baseDir: BaseDirectory.Document });
                    await writeFile(newImgPath, imgBytes, { baseDir: BaseDirectory.Document });
                  }
                }
              } catch (imgErr) {
                console.warn(`[StorageService] Could not copy image ${safeKey}:`, imgErr);
              }
            }
          }
        }
      }

      // Remove legacy monolithic notebooks.json now that per-notebook folders exist
      await remove(legacyJsonPath, { baseDir: BaseDirectory.Document });
      console.log('[StorageService] Completed migration to per-notebook folders!');
    }
  } catch (err) {
    console.warn('[StorageService] Legacy migration notice:', err);
  }
}

/**
 * Saves a single notebook to ~/Documents/Notebook/<folder>/notebook.json
 */
export async function saveNotebookToDisk(notebook: Notebook): Promise<boolean> {
  if (!isTauriEnvironment()) return false;

  try {
    await initDocumentsStorage();
    const folder = getNotebookFolderName(notebook);
    const nbDir = `${ROOT_DIR}/${folder}`;
    const imgDir = `${nbDir}/images`;

    if (!(await exists(nbDir, { baseDir: BaseDirectory.Document }))) {
      await mkdir(nbDir, { baseDir: BaseDirectory.Document, recursive: true });
    }
    if (!(await exists(imgDir, { baseDir: BaseDirectory.Document }))) {
      await mkdir(imgDir, { baseDir: BaseDirectory.Document, recursive: true });
    }

    const data = JSON.stringify(notebook, null, 2);
    const encoded = new TextEncoder().encode(data);
    await writeFile(`${nbDir}/notebook.json`, encoded, { baseDir: BaseDirectory.Document });
    return true;
  } catch (err) {
    console.error(`[StorageService] Failed to save notebook "${notebook.name}" to disk:`, err);
    return false;
  }
}

/**
 * Saves multiple notebooks to their respective ~/Documents/Notebook/<folder>/notebook.json files
 */
export async function saveNotebooksToDisk(notebooks: Notebook[]): Promise<boolean> {
  if (!isTauriEnvironment()) return false;

  let allOk = true;
  for (const nb of notebooks) {
    const ok = await saveNotebookToDisk(nb);
    if (!ok) allOk = false;
  }
  return allOk;
}

/**
 * Loads all notebooks by scanning each subfolder notebook.json
 */
export async function loadAllNotebooksFromDisk(): Promise<Notebook[] | null> {
  if (!isTauriEnvironment()) return null;

  try {
    await initDocumentsStorage();
    await migrateLegacyStorageIfPresent();

    const entries = await readDir(ROOT_DIR, { baseDir: BaseDirectory.Document });
    const loadedNotebooks: Notebook[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory || entry.name === 'images') continue;

      const nbMetaPath = `${ROOT_DIR}/${entry.name}/notebook.json`;
      try {
        if (await exists(nbMetaPath, { baseDir: BaseDirectory.Document })) {
          const bytes = await readFile(nbMetaPath, { baseDir: BaseDirectory.Document });
          const raw = new TextDecoder().decode(bytes);
          const nb = JSON.parse(raw) as Notebook;
          if (nb && nb.id && nb.name) {
            loadedNotebooks.push(nb);
          }
        }
      } catch (err) {
        console.warn(`[StorageService] Failed to read notebook from ${entry.name}:`, err);
      }
    }

    if (loadedNotebooks.length > 0) {
      // Sort most recently updated first
      loadedNotebooks.sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt));
      console.log(`[StorageService] Successfully loaded ${loadedNotebooks.length} notebooks from per-notebook folders`);
      return loadedNotebooks;
    }

    return null;
  } catch (err) {
    console.error('[StorageService] Failed to load notebooks from disk:', err);
    return null;
  }
}

/** Backward compatibility alias for loadNotebooksFromDisk */
export const loadNotebooksFromDisk = loadAllNotebooksFromDisk;

/**
 * Deletes a notebook's directory from disk: ~/Documents/Notebook/<folder>/
 */
export async function deleteNotebookFromDisk(notebook: Notebook): Promise<void> {
  if (!isTauriEnvironment()) return;

  try {
    const folder = getNotebookFolderName(notebook);
    const nbDir = `${ROOT_DIR}/${folder}`;
    if (await exists(nbDir, { baseDir: BaseDirectory.Document })) {
      await remove(nbDir, { baseDir: BaseDirectory.Document, recursive: true });
      console.log(`[StorageService] Deleted notebook directory ~/Documents/${nbDir}`);
    }
  } catch (err) {
    console.warn(`[StorageService] Failed to delete notebook directory for "${notebook.name}":`, err);
  }
}

/**
 * Saves an image/PDF page blob to ~/Documents/Notebook/<folder>/images/<key>.jpg
 */
export async function saveImageToDisk(key: string, blob: Blob, notebookFolderName?: string): Promise<boolean> {
  if (!isTauriEnvironment()) return false;

  try {
    await initDocumentsStorage();
    const safeName = `${sanitizeKey(key)}.jpg`;

    let targetDir = IMAGES_DIR;
    if (notebookFolderName) {
      targetDir = `${ROOT_DIR}/${notebookFolderName}/images`;
    }

    if (!(await exists(targetDir, { baseDir: BaseDirectory.Document }))) {
      await mkdir(targetDir, { baseDir: BaseDirectory.Document, recursive: true });
    }

    const targetPath = `${targetDir}/${safeName}`;
    const arrayBuffer = await blob.arrayBuffer();
    await writeFile(targetPath, new Uint8Array(arrayBuffer), { baseDir: BaseDirectory.Document });
    return true;
  } catch (err) {
    console.error(`[StorageService] Failed to save image ${key} to disk:`, err);
    return false;
  }
}

/**
 * Loads an image from ~/Documents/Notebook/<folder>/images/<key>.jpg
 * If notebookFolderName is not passed, searches all notebook folders.
 */
export async function loadImageFromDisk(key: string, notebookFolderName?: string): Promise<Blob | null> {
  if (!isTauriEnvironment()) return null;

  try {
    const safeName = `${sanitizeKey(key)}.jpg`;

    // 1. Direct path if notebook folder name provided
    if (notebookFolderName) {
      const p = `${ROOT_DIR}/${notebookFolderName}/images/${safeName}`;
      if (await exists(p, { baseDir: BaseDirectory.Document })) {
        const bytes = await readFile(p, { baseDir: BaseDirectory.Document });
        return new Blob([bytes], { type: 'image/jpeg' });
      }
    }

    // 2. Search across all notebook image directories
    try {
      const entries = await readDir(ROOT_DIR, { baseDir: BaseDirectory.Document });
      for (const entry of entries) {
        if (!entry.isDirectory || entry.name === 'images') continue;
        const candidatePath = `${ROOT_DIR}/${entry.name}/images/${safeName}`;
        if (await exists(candidatePath, { baseDir: BaseDirectory.Document })) {
          const bytes = await readFile(candidatePath, { baseDir: BaseDirectory.Document });
          return new Blob([bytes], { type: 'image/jpeg' });
        }
      }
    } catch {
      // Ignored
    }

    // 3. Fallback to legacy root images dir
    const legacyPath = `${IMAGES_DIR}/${safeName}`;
    if (await exists(legacyPath, { baseDir: BaseDirectory.Document })) {
      const bytes = await readFile(legacyPath, { baseDir: BaseDirectory.Document });
      return new Blob([bytes], { type: 'image/jpeg' });
    }

    return null;
  } catch (err) {
    console.error(`[StorageService] Failed to load image ${key} from disk:`, err);
    return null;
  }
}

/**
 * Deletes an image file from ~/Documents/Notebook/<folder>/images/<key>.jpg
 */
export async function deleteImageFromDisk(key: string, notebookFolderName?: string): Promise<void> {
  if (!isTauriEnvironment()) return;

  try {
    const safeName = `${sanitizeKey(key)}.jpg`;
    if (notebookFolderName) {
      const targetPath = `${ROOT_DIR}/${notebookFolderName}/images/${safeName}`;
      if (await exists(targetPath, { baseDir: BaseDirectory.Document })) {
        await remove(targetPath, { baseDir: BaseDirectory.Document });
        return;
      }
    }

    // Search and remove across folders
    const entries = await readDir(ROOT_DIR, { baseDir: BaseDirectory.Document });
    for (const entry of entries) {
      if (!entry.isDirectory) continue;
      const p = `${ROOT_DIR}/${entry.name}/images/${safeName}`;
      if (await exists(p, { baseDir: BaseDirectory.Document })) {
        await remove(p, { baseDir: BaseDirectory.Document });
      }
    }
  } catch (err) {
    console.warn(`[StorageService] Failed to delete image ${key} from disk:`, err);
  }
}
