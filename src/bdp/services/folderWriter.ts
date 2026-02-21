/**
 * BDP — Folder Writer Service (D2)
 *
 * Writes received files back to the real filesystem via the File System
 * Access API (Tier 1: Chrome/Edge desktop). Gracefully falls back to
 * OPFS-only on unsupported browsers — the vault is always written
 * regardless of whether the real-FS write succeeds.
 *
 * Tier model:
 *   Tier 1 (Chrome/Edge): FSAPI write-through to the real folder the user
 *                         picked during pair setup. Files land where the
 *                         user expects them.
 *   Tier 0 (all others):  No-op — files are accessible via the Vault Browser
 *                         UI from OPFS only.
 *
 * Permission:
 *   The handle stored by folderReader.ts must have 'readwrite' permission.
 *   If permission has been revoked (e.g. after a browser restart), the write
 *   returns false and the caller should prompt the user to re-grant.
 *
 * Dependencies: idb.ts, opfsVault.ts
 */

import type { PairId } from "@/types/bdp";
import { readFileFromVault } from "./opfsVault";
import { getStoredHandle, verifyHandlePermission } from "./folderReader";

// ─────────────────────────────────────────────────────────────────────────────
// Capability check
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns true if the File System Access API write path is available.
 * Checks for showDirectoryPicker() — the same gate used by folderReader.ts.
 *
 * Note: availability ≠ permission. The user may have a handle but revoked
 * permission. Always call verifyHandlePermission() before writing.
 */
export function canWriteRealFS(): boolean {
  return "showDirectoryPicker" in window;
}

// ─────────────────────────────────────────────────────────────────────────────
// Core write primitive
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Writes a single file to the real filesystem under the given directory handle.
 *
 * Creates intermediate directories as needed (mirrors the path structure).
 * Uses FileSystemWritableFileStream for atomic-ish writes — the browser
 * flushes to disk only when writable.close() is called.
 *
 * @param handle - Root directory handle for the sync pair's folder
 * @param path   - Relative path within the folder (e.g. "src/utils/helper.ts")
 * @param data   - File content as a Blob
 * @returns true on success, false if FSAPI is unavailable or any error occurs
 */
export async function writeToRealFS(
  handle: FileSystemDirectoryHandle,
  path: string,
  data: Blob,
): Promise<boolean> {
  if (!canWriteRealFS()) return false;

  try {
    const segments = path.split("/");
    const fileName = segments[segments.length - 1];
    const dirSegments = segments.slice(0, -1);

    // Navigate / create intermediate directory segments
    let dir = handle;
    for (const segment of dirSegments) {
      if (!segment) continue; // skip empty segments from leading/trailing slashes
      dir = await dir.getDirectoryHandle(segment, { create: true });
    }

    // Write the file
    const fileHandle = await dir.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(data);
    await writable.close();

    return true;
  } catch (err) {
    if (import.meta.env.DEV) {
      console.warn(`[BDP folderWriter] writeToRealFS failed for "${path}":`, err);
    }
    return false;
  }
}

/**
 * Deletes a single file from the real filesystem.
 * No-op (returns false) if FSAPI is unavailable, path doesn't exist, or
 * any error occurs.
 *
 * @param handle - Root directory handle
 * @param path   - Relative path to the file to remove
 * @returns true if the file was deleted, false otherwise
 */
export async function deleteFromRealFS(
  handle: FileSystemDirectoryHandle,
  path: string,
): Promise<boolean> {
  if (!canWriteRealFS()) return false;

  try {
    const segments = path.split("/");
    const fileName = segments[segments.length - 1];
    const dirSegments = segments.slice(0, -1);

    let dir = handle;
    for (const segment of dirSegments) {
      if (!segment) continue;
      try {
        dir = await dir.getDirectoryHandle(segment, { create: false });
      } catch {
        return false; // directory doesn't exist — file is already gone
      }
    }

    await dir.removeEntry(fileName);
    return true;
  } catch (err) {
    if (err instanceof DOMException && err.name === "NotFoundError") {
      return false; // already gone — that's fine
    }
    if (import.meta.env.DEV) {
      console.warn(`[BDP folderWriter] deleteFromRealFS failed for "${path}":`, err);
    }
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Batch sync: vault → real FS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Result of a batch vault-to-real-FS sync operation.
 */
export interface SyncResult {
  succeeded: number;
  failed: number;
  /** Paths that failed to write (for error reporting in the UI) */
  failedPaths: string[];
  /** true if FSAPI was unavailable (Tier 0 device) */
  notSupported: boolean;
}

/**
 * Reads each path from the OPFS vault and writes it through to the real
 * filesystem using the pair's stored directory handle.
 *
 * This is the "Tier 1 write-through" step: called after a successful download
 * batch to materialise received files on disk where the user expects them.
 *
 * Steps per path:
 *  1. Read the Blob from the OPFS vault (opfsVault.readFileFromVault)
 *  2. Write it to the real FS via the stored FSAPI handle
 *
 * If the handle's permission has expired, attempts to re-verify once.
 * If re-verification fails, all remaining writes are skipped.
 *
 * @param pairId - The sync pair (used to look up the stored handle + vault)
 * @param handle - The real filesystem directory handle for this pair
 * @param paths  - Relative file paths to sync from vault to real FS
 * @returns SyncResult with counts and any failed paths
 */
export async function syncVaultToRealFS(
  pairId: PairId,
  handle: FileSystemDirectoryHandle,
  paths: string[],
): Promise<SyncResult> {
  if (!canWriteRealFS()) {
    return { succeeded: 0, failed: 0, failedPaths: [], notSupported: true };
  }

  // Verify permission upfront — avoids per-file error noise
  const hasPermission = await verifyHandlePermission(handle);
  if (!hasPermission) {
    return {
      succeeded: 0,
      failed: paths.length,
      failedPaths: paths,
      notSupported: false,
    };
  }

  let succeeded = 0;
  let failed = 0;
  const failedPaths: string[] = [];

  for (const path of paths) {
    // Read from OPFS vault
    const blob = await readFileFromVault(pairId, path);
    if (!blob) {
      // File not in vault yet (transfer may be incomplete) — skip
      failed++;
      failedPaths.push(path);
      continue;
    }

    const ok = await writeToRealFS(handle, path, blob);
    if (ok) {
      succeeded++;
    } else {
      failed++;
      failedPaths.push(path);
    }
  }

  return { succeeded, failed, failedPaths, notSupported: false };
}

/**
 * Convenience wrapper: looks up the stored handle for a pair, verifies
 * permission, then syncs the given paths from vault to real FS.
 *
 * Returns notSupported = true if:
 *   - FSAPI is unavailable (Tier 0 device)
 *   - No stored handle for this pair
 *   - Permission was revoked and could not be re-granted
 *
 * @param pairId - The sync pair
 * @param paths  - Relative paths to write through to the real filesystem
 * @returns SyncResult
 */
export async function syncVaultToRealFSForPair(
  pairId: PairId,
  paths: string[],
): Promise<SyncResult> {
  if (!canWriteRealFS()) {
    return { succeeded: 0, failed: 0, failedPaths: [], notSupported: true };
  }

  const handle = await getStoredHandle(pairId);
  if (!handle) {
    return { succeeded: 0, failed: 0, failedPaths: [], notSupported: true };
  }

  return syncVaultToRealFS(pairId, handle, paths);
}

// ─────────────────────────────────────────────────────────────────────────────
// Directory utilities
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Creates a directory (and all intermediate parents) within the given handle.
 * No-op if the directory already exists.
 *
 * @param root    - Starting directory handle
 * @param dirPath - Relative path of the directory to create (e.g. "src/utils")
 * @returns The handle for the deepest created/existing directory
 * @throws If FSAPI is unavailable or permission is denied
 */
export async function ensureDirectory(
  root: FileSystemDirectoryHandle,
  dirPath: string,
): Promise<FileSystemDirectoryHandle> {
  const segments = dirPath.split("/").filter(Boolean);
  let current = root;
  for (const segment of segments) {
    current = await current.getDirectoryHandle(segment, { create: true });
  }
  return current;
}

/**
 * Recursively removes a directory from the real filesystem.
 * Used when a sync pair is deleted and the user wants to clean up the folder.
 *
 * Requires FSAPI + readwrite permission. Returns false on any failure.
 *
 * @param handle  - Root directory handle containing the target
 * @param dirPath - Relative path of the directory to remove (empty = root itself)
 * @returns true if successfully removed, false otherwise
 */
export async function removeDirectoryFromRealFS(
  handle: FileSystemDirectoryHandle,
  dirPath: string,
): Promise<boolean> {
  if (!canWriteRealFS()) return false;

  try {
    if (!dirPath) {
      // Can't remove the root handle itself — that's controlled by the browser
      return false;
    }

    const segments = dirPath.split("/").filter(Boolean);
    const targetName = segments[segments.length - 1];
    const parentSegments = segments.slice(0, -1);

    let parentDir = handle;
    for (const segment of parentSegments) {
      parentDir = await parentDir.getDirectoryHandle(segment, { create: false });
    }

    await parentDir.removeEntry(targetName, { recursive: true });
    return true;
  } catch (err) {
    if (err instanceof DOMException && err.name === "NotFoundError") {
      return false;
    }
    if (import.meta.env.DEV) {
      console.warn(
        `[BDP folderWriter] removeDirectoryFromRealFS failed for "${dirPath}":`,
        err,
      );
    }
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// File existence check
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Checks whether a file exists at the given path within the handle.
 * Does NOT require readwrite permission — queryPermission('read') is enough.
 *
 * @param handle - Root directory handle
 * @param path   - Relative file path
 * @returns true if the file exists, false if not found or any error occurs
 */
export async function existsInRealFS(
  handle: FileSystemDirectoryHandle,
  path: string,
): Promise<boolean> {
  try {
    const segments = path.split("/");
    const fileName = segments[segments.length - 1];
    const dirSegments = segments.slice(0, -1);

    let dir = handle;
    for (const segment of dirSegments) {
      if (!segment) continue;
      dir = await dir.getDirectoryHandle(segment, { create: false });
    }

    await dir.getFileHandle(fileName, { create: false });
    return true;
  } catch {
    return false;
  }
}
