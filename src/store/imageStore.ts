import { get, set, del, keys } from 'idb-keyval';
import {
  saveImageToDisk,
  loadImageFromDisk,
  deleteImageFromDisk,
  getNotebookFolderName,
} from '../services/storageService';
import { useNotesStore } from './useNotesStore';

const urlCache = new Map<string, string>();

function getActiveNotebookFolderName(): string | undefined {
  try {
    const state = useNotesStore.getState();
    const activeNb = state.notebooks.find((n) => n.id === state.activeNotebookId);
    if (activeNb) {
      return getNotebookFolderName(activeNb);
    }
  } catch {
    // Store might not be ready yet
  }
  return undefined;
}

export async function putPageImage(key: string, blob: Blob) {
  // Save to IndexedDB for quick local access
  await set(key, blob);
  // Also persist to ~/Documents/Notebook/<Notebook_Name>/images/ so it survives app reinstalls
  const folder = getActiveNotebookFolderName();
  saveImageToDisk(key, blob, folder).catch((err) => {
    console.warn('[ImageStore] Failed to persist image to Documents:', err);
  });
}

/**
 * Caches an imported image in IndexedDB only. The archive importer writes the
 * disk copy into the imported notebook's own folder, so it must not go through
 * putPageImage (which targets the currently active notebook).
 */
export async function cachePageImage(key: string, blob: Blob) {
  await set(key, blob);
}

/** Returns an object URL, memoised. Safe to call during render via useEffect. */
export async function getPageImageUrl(key: string): Promise<string | null> {
  const cached = urlCache.get(key);
  if (cached) return cached;

  let blob = await get<Blob>(key);
  if (!blob) {
    // If not found in IndexedDB (e.g., after app reinstall), recover from Documents
    const folder = getActiveNotebookFolderName();
    blob = (await loadImageFromDisk(key, folder)) ?? undefined;
    if (blob) {
      await set(key, blob);
    }
  }

  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  urlCache.set(key, url);
  return url;
}

export async function getPageBlob(key: string): Promise<Blob | null> {
  let blob = await get<Blob>(key);
  if (!blob) {
    const folder = getActiveNotebookFolderName();
    blob = (await loadImageFromDisk(key, folder)) ?? undefined;
    if (blob) {
      await set(key, blob);
    }
  }
  return blob ?? null;
}

export async function deletePageImage(key: string) {
  const url = urlCache.get(key);
  if (url) {
    URL.revokeObjectURL(url);
    urlCache.delete(key);
  }
  await del(key);
  const folder = getActiveNotebookFolderName();
  await deleteImageFromDisk(key, folder);
}

/** Stores an AI-capture screenshot. IndexedDB only — never mirrored into a notebook folder. */
export async function putAiImage(key: string, blob: Blob) {
  await set(key, blob);
}

/** Run once on app start: drop IDB blobs no element references anymore. */
export async function collectGarbage(liveKeys: Set<string>) {
  for (const k of await keys()) {
    if (
      typeof k === 'string' &&
      (k.startsWith('page:') || k.startsWith('img:') || k.startsWith('ai:')) &&
      !liveKeys.has(k)
    ) {
      await del(k);
    }
  }
}

export function revokeAllCachedUrls() {
  for (const [, url] of urlCache) {
    URL.revokeObjectURL(url);
  }
  urlCache.clear();
}
