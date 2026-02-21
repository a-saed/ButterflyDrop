/**
 * BDP — Folder Reader Service (D1)
 *
 * Unified API for reading a folder from the real filesystem.
 * Hides the showDirectoryPicker() vs <input webkitdirectory> difference,
 * presenting a single consistent interface regardless of browser.
 *
 * Tier model:
 *   Tier 1 (Chrome/Edge desktop): showDirectoryPicker() → persistent handle
 *   Tier 0 (Firefox/Safari/mobile): <input webkitdirectory> → one-time File[]
 *
 * Change detection:
 *   Uses mtime + size as a fast pre-filter. Only computes SHA-256 when
 *   metadata differs, keeping re-scans cheap for unchanged folders.
 *
 * Handle persistence:
 *   FSAPI handles are stored in IndexedDB (deviceKeys store) so Chrome can
 *   re-verify permission on the next app load without re-prompting.
 *
 * Dependencies: idb.ts, src/lib/fileHashing.ts, src/types/bdp.ts
 */

import type { BDPFileEntry, PairId, SHA256Hex } from "@/types/bdp";
import { BDP_CONSTANTS } from "@/types/bdp";
import { calculateFileHash } from "@/lib/fileHashing";
import { getAllFileEntries, openDB } from "./idb";

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

/** A single file discovered during a folder scan. */
export interface ScanEntry {
  /** Unix-style path relative to the folder root. e.g. "src/utils/helper.ts" */
  path: string;
  /** The browser File object — has .arrayBuffer(), .stream(), etc. */
  file: File;
  /** SHA-256 hex digest. Only populated when hashAll = true or on change detection. */
  hash?: SHA256Hex;
}

/** Result of a successful folder pick operation. */
export interface PickResult {
  /** The top-level folder name (e.g. "my-project") */
  folderName: string;
  /**
   * The FSAPI directory handle on Chrome/Edge, null on Firefox/Safari/mobile.
   * When non-null: stored in IDB for re-use on next launch.
   */
  handle: FileSystemDirectoryHandle | null;
  /** Async iterable of all files found in the folder (recursively). */
  entries: AsyncIterable<ScanEntry>;
}

/** Result of detectChanges() — what's new, modified, or deleted. */
export interface FolderDiff {
  added: ScanEntry[];
  modified: ScanEntry[];
  /** Entries that were in the index but are no longer on disk */
  deleted: BDPFileEntry[];
}

// ─────────────────────────────────────────────────────────────────────────────
// IDB handle persistence — separate from the main idb.ts stores
// ─────────────────────────────────────────────────────────────────────────────

const HANDLE_STORE = "deviceKeys"; // reuse existing store (keyPath: null)

function handleKey(pairId: PairId): string {
  return `fshandle-${pairId}`;
}

/**
 * Stores a FileSystemDirectoryHandle in IndexedDB for a given pair.
 * The handle is persisted so Chrome can re-verify permission on next load.
 *
 * @param pairId - The sync pair
 * @param handle - The directory handle to persist
 */
export async function storeHandle(
  pairId: PairId,
  handle: FileSystemDirectoryHandle,
): Promise<void> {
  const db = await openDB();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(HANDLE_STORE, "readwrite");
    const req = tx.objectStore(HANDLE_STORE).put(handle, handleKey(pairId));
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/**
 * Loads a previously stored FileSystemDirectoryHandle from IndexedDB.
 *
 * @param pairId - The sync pair
 * @returns The stored handle, or null if none exists
 */
export async function getStoredHandle(
  pairId: PairId,
): Promise<FileSystemDirectoryHandle | null> {
  const db = await openDB();
  return new Promise<FileSystemDirectoryHandle | null>((resolve, reject) => {
    const tx = db.transaction(HANDLE_STORE, "readonly");
    const req = tx.objectStore(HANDLE_STORE).get(handleKey(pairId));
    req.onsuccess = () =>
      resolve((req.result as FileSystemDirectoryHandle | undefined) ?? null);
    req.onerror = () => reject(req.error);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Permission verification
// ─────────────────────────────────────────────────────────────────────────────

/**
 * FileSystemDirectoryHandle with the permission query/request methods.
 * These are part of the File System Access API but omitted from TypeScript's
 * DOM lib — the cast is safe on Chrome/Edge where FSAPI is available.
 */
interface FSHandleWithPermission extends FileSystemDirectoryHandle {
  queryPermission(opts: {
    mode: "read" | "readwrite";
  }): Promise<PermissionState>;
  requestPermission(opts: {
    mode: "read" | "readwrite";
  }): Promise<PermissionState>;
}

/**
 * Checks (and optionally requests) read-write permission for a directory handle.
 *
 * Chrome requires the user to re-grant permission after a page reload.
 * This function first queries the current state; if not granted, it prompts.
 *
 * @param handle - The directory handle to verify
 * @returns true if permission is granted, false otherwise
 */
export async function verifyHandlePermission(
  handle: FileSystemDirectoryHandle,
): Promise<boolean> {
  const h = handle as FSHandleWithPermission;

  // queryPermission / requestPermission are only available on FSAPI-capable
  // browsers (Chrome/Edge). Guard so Firefox/Safari return true gracefully.
  if (typeof h.queryPermission !== "function") return true;

  const opts = { mode: "readwrite" as const };

  // Query without prompting first
  const current = await h.queryPermission(opts);
  if (current === "granted") return true;

  // Prompt the user
  const requested = await h.requestPermission(opts);
  return requested === "granted";
}

// ─────────────────────────────────────────────────────────────────────────────
// FSAPI async iteration helper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * TypeScript's DOM lib omits the async iterable protocol on
 * FileSystemDirectoryHandle. This cast is safe in all OPFS-capable browsers.
 */
function dirEntries(
  dir: FileSystemDirectoryHandle,
): AsyncIterable<[string, FileSystemHandle]> {
  return dir as unknown as AsyncIterable<[string, FileSystemHandle]>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Core scanning (FSAPI path)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Recursively scans a FileSystemDirectoryHandle, yielding ScanEntry for
 * every file found (depth-first).
 *
 * @param dir - Directory handle to scan
 * @param prefix - Relative path accumulated so far (empty at root)
 * @param hashAll - If true, compute SHA-256 for every file
 */
async function* walkHandle(
  dir: FileSystemDirectoryHandle,
  prefix: string,
  hashAll: boolean,
): AsyncGenerator<ScanEntry> {
  for await (const [name, handle] of dirEntries(dir)) {
    const relativePath = prefix ? `${prefix}/${name}` : name;

    if (handle.kind === "directory") {
      yield* walkHandle(
        handle as FileSystemDirectoryHandle,
        relativePath,
        hashAll,
      );
    } else {
      const fileHandle = handle as FileSystemFileHandle;
      const file = await fileHandle.getFile();

      // Skip files that exceed the size limit
      if (file.size > BDP_CONSTANTS.CHUNK_SIZE * 2000) {
        // ~500 MB
        continue;
      }

      let hash: SHA256Hex | undefined;
      if (hashAll) {
        hash = (await calculateFileHash(file)) as SHA256Hex;
      }

      yield { path: relativePath, file, hash };
    }
  }
}

/**
 * Eagerly scans a FileSystemDirectoryHandle and returns all entries as an array.
 * Suitable when you need the full list before processing.
 *
 * @param handle - The directory to scan
 * @param options - Scan options
 * @returns Array of ScanEntry objects
 */
export async function scanHandle(
  handle: FileSystemDirectoryHandle,
  options?: { hashAll?: boolean },
): Promise<ScanEntry[]> {
  const results: ScanEntry[] = [];
  for await (const entry of walkHandle(handle, "", options?.hashAll ?? false)) {
    results.push(entry);
  }
  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// webkitdirectory fallback (Firefox / Safari / mobile)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Creates a hidden <input type="file" webkitdirectory> and triggers a click,
 * resolving with the selected FileList or null if cancelled.
 */
function pickWithInput(): Promise<FileList | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    // webkitdirectory is supported in all modern browsers despite the prefix
    (input as HTMLInputElement & { webkitdirectory: boolean }).webkitdirectory =
      true;
    input.multiple = true;
    input.style.display = "none";

    let settled = false;

    const cleanup = () => {
      input.remove();
    };

    input.addEventListener("change", () => {
      settled = true;
      cleanup();
      resolve(input.files && input.files.length > 0 ? input.files : null);
    });

    // Handle cancel: focus event fires on the window after the dialog closes
    const onFocus = () => {
      setTimeout(() => {
        if (!settled) {
          settled = true;
          cleanup();
          window.removeEventListener("focus", onFocus);
          resolve(null);
        }
      }, 500);
    };

    window.addEventListener("focus", onFocus, { once: true });

    document.body.appendChild(input);
    input.click();
  });
}

/**
 * Converts a FileList from webkitdirectory input into ScanEntry objects.
 * webkitRelativePath has format: "folderName/rest/of/path"
 * We strip the leading folder name to get the root-relative path.
 */
function fileListToEntries(
  files: FileList,
  hashAll: boolean,
): Promise<ScanEntry[]> {
  const promises = Array.from(files).map(async (f) => {
    const rel =
      (f as File & { webkitRelativePath?: string }).webkitRelativePath ??
      f.name;
    // Strip the leading folder segment ("folderName/src/..." → "src/...")
    const path = rel.includes("/") ? rel.split("/").slice(1).join("/") : rel;

    let hash: SHA256Hex | undefined;
    if (hashAll) {
      hash = (await calculateFileHash(f)) as SHA256Hex;
    }

    return { path, file: f, hash };
  });
  return Promise.all(promises);
}

// ─────────────────────────────────────────────────────────────────────────────
// Async iterable helper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Wraps an array as an AsyncIterable<T> so both FSAPI and fallback paths
 * expose the same interface to callers.
 */
async function* asyncIterFromArray<T>(arr: T[]): AsyncGenerator<T> {
  for (const item of arr) {
    yield item;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Public: pickFolder
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Opens a folder picker dialog and returns the selected folder's contents.
 *
 * Tries showDirectoryPicker() first (Chrome/Edge desktop). If unavailable or
 * the user cancels, falls back to a hidden <input webkitdirectory>.
 *
 * Returns null if the user cancels both pickers.
 *
 * @param options.hashAll - If true, SHA-256 hash every file during the scan.
 *   Expensive for large folders; prefer false and hash-on-change instead.
 * @returns PickResult on success, null on cancel
 */
export async function pickFolder(options?: {
  hashAll?: boolean;
}): Promise<PickResult | null> {
  const hashAll = options?.hashAll ?? false;

  // ── Tier 1: File System Access API (Chrome/Edge) ──────────────────────────
  if ("showDirectoryPicker" in window) {
    try {
      const handle = await (
        window as Window & {
          showDirectoryPicker(opts?: {
            mode?: "read" | "readwrite";
          }): Promise<FileSystemDirectoryHandle>;
        }
      ).showDirectoryPicker({ mode: "readwrite" });

      const generator = walkHandle(handle, "", hashAll);

      return {
        folderName: handle.name,
        handle,
        entries: {
          [Symbol.asyncIterator]: () => generator,
        },
      };
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        return null; // User cancelled the picker
      }
      // Other error (e.g. SecurityError) — fall through to input fallback
      if (import.meta.env.DEV) {
        console.warn(
          "[BDP folderReader] showDirectoryPicker failed, falling back to input:",
          err,
        );
      }
    }
  }

  // ── Tier 0: <input webkitdirectory> fallback ──────────────────────────────
  const files = await pickWithInput();
  if (!files || files.length === 0) return null;

  // Extract the top-level folder name from the first file's relative path
  const firstRel =
    (files[0] as File & { webkitRelativePath?: string }).webkitRelativePath ??
    files[0].name;
  const folderName = firstRel.split("/")[0] || "folder";

  const entries = await fileListToEntries(files, hashAll);

  return {
    folderName,
    handle: null,
    entries: {
      [Symbol.asyncIterator]: () => asyncIterFromArray(entries),
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Public: detectChanges
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compares a freshly scanned set of files against the stored BDP index,
 * returning which files were added, modified, or deleted.
 *
 * Change detection strategy (fast first, precise second):
 *  1. Size OR mtime changed → compute full SHA-256 to confirm
 *  2. Size AND mtime identical → assume unchanged (no hash needed)
 *  3. Path present in index but absent from scan → deleted
 *
 * This keeps re-scans cheap for large unchanged folders while correctly
 * detecting in-place edits that preserve file size.
 *
 * @param pairId - The sync pair whose index to compare against
 * @param currentEntries - Fresh entries from scanHandle() or pickFolder()
 * @returns FolderDiff — what changed since the last index
 */
export async function detectChanges(
  pairId: PairId,
  currentEntries: ScanEntry[],
): Promise<FolderDiff> {
  const indexed = await getAllFileEntries(pairId);
  const indexMap = new Map(indexed.map((e) => [e.path, e]));
  const currentMap = new Map(currentEntries.map((e) => [e.path, e]));

  const added: ScanEntry[] = [];
  const modified: ScanEntry[] = [];
  const deleted: BDPFileEntry[] = [];

  // ── Check current files against the index ─────────────────────────────────
  for (const current of currentEntries) {
    const stored = indexMap.get(current.path);

    if (!stored || stored.tombstone) {
      // New file — not in index (or previously deleted)
      // Compute hash now so the caller can build a BDPFileEntry immediately
      if (!current.hash) {
        current.hash = (await calculateFileHash(current.file)) as SHA256Hex;
      }
      added.push(current);
      continue;
    }

    // Fast pre-check: size + mtime
    const sizeChanged = current.file.size !== stored.size;
    const mtimeChanged = current.file.lastModified !== stored.mtime;

    if (!sizeChanged && !mtimeChanged) {
      // Metadata identical → assume unchanged, skip expensive hash
      continue;
    }

    // Metadata changed → verify with SHA-256
    if (!current.hash) {
      current.hash = (await calculateFileHash(current.file)) as SHA256Hex;
    }

    if (current.hash !== stored.hash) {
      modified.push(current);
    }
    // If hash matches despite mtime change (e.g. touch), it's unchanged
  }

  // ── Check for deletions ────────────────────────────────────────────────────
  for (const entry of indexed) {
    if (entry.tombstone) continue; // already deleted
    if (!currentMap.has(entry.path)) {
      deleted.push(entry);
    }
  }

  return { added, modified, deleted };
}

// ─────────────────────────────────────────────────────────────────────────────
// Public: buildFileEntry helper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Builds a partial BDPFileEntry from a ScanEntry.
 * The caller must supply pairId, deviceId, seq, and vectorClock.
 *
 * Chunks the file into BDP_CONSTANTS.CHUNK_SIZE pieces and computes each
 * chunk's SHA-256 hash — this is the authoritative chunk list used by
 * the CAS and protocol layers.
 *
 * @param entry - Scanned file entry (must have hash populated)
 * @returns Partial file entry ready for index insertion
 */
export async function buildChunkHashes(entry: ScanEntry): Promise<SHA256Hex[]> {
  const chunkSize = BDP_CONSTANTS.CHUNK_SIZE;
  const file = entry.file;
  const chunkHashes: SHA256Hex[] = [];

  let offset = 0;
  while (offset < file.size) {
    const slice = file.slice(offset, offset + chunkSize);
    const buf = await slice.arrayBuffer();
    const digest = await crypto.subtle.digest("SHA-256", buf);
    const hex = Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("") as SHA256Hex;
    chunkHashes.push(hex);
    offset += chunkSize;
  }

  // Handle empty files — one empty chunk
  if (chunkHashes.length === 0) {
    const emptyDigest = await crypto.subtle.digest(
      "SHA-256",
      new ArrayBuffer(0),
    );
    const hex = Array.from(new Uint8Array(emptyDigest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("") as SHA256Hex;
    chunkHashes.push(hex);
  }

  return chunkHashes;
}

/**
 * Returns true if the file's extension is in the "already compressed" set,
 * meaning the CAS should not attempt deflate-raw compression.
 *
 * @param filename - The file's name (with extension)
 */
export function isAlreadyCompressed(filename: string): boolean {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return BDP_CONSTANTS.ALREADY_COMPRESSED_EXTENSIONS.has(ext);
}
