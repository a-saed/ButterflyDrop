/**
 * Folder Scanner Utilities
 * Cross-browser folder scanning with File System Access API and fallbacks
 */

import type { FileSnapshot } from '@/types/sync';
import { calculateFileHash, calculateMetadataHash } from './fileHashing';

/**
 * Browser capabilities detection
 */
export function detectBrowserCapabilities(): {
  hasFileSystemAccessAPI: boolean;
  hasIndexedDB: boolean;
  hasWebWorkers: boolean;
  isMobile: boolean;
} {
  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
    navigator.userAgent
  );

  return {
    hasFileSystemAccessAPI: 'showDirectoryPicker' in window,
    hasIndexedDB: 'indexedDB' in window,
    hasWebWorkers: typeof Worker !== 'undefined',
    isMobile,
  };
}

/**
 * Request folder access using File System Access API (Chrome/Edge)
 */
export async function requestFolderAccess(): Promise<FileSystemDirectoryHandle | null> {
  if (!('showDirectoryPicker' in window)) {
    return null;
  }

  try {
    const handle = await (window as any).showDirectoryPicker({
      mode: 'readwrite', // Request read-write access
    });
    return handle;
  } catch (error) {
    if ((error as Error).name === 'AbortError') {
      // User cancelled
      return null;
    }
    throw error;
  }
}

/**
 * Scan folder using File System Access API
 * Recursively scans directory and creates file snapshots
 */
export async function scanFolderWithHandle(
  handle: FileSystemDirectoryHandle,
  configId: string,
  basePath: string = '',
  maxDepth: number = 10
): Promise<FileSnapshot[]> {
  const snapshots: FileSnapshot[] = [];

  async function scanDirectory(
    dirHandle: FileSystemDirectoryHandle,
    currentPath: string,
    depth: number
  ): Promise<void> {
    if (depth > maxDepth) {
      console.warn(`Max depth reached at ${currentPath}`);
      return;
    }

    try {
      for await (const [name, entry] of dirHandle.entries()) {
        const entryPath = currentPath ? `${currentPath}/${name}` : name;

        if (entry.kind === 'file') {
          try {
            const file = await entry.getFile();
            const hash = await calculateFileHash(file);

            const snapshot: FileSnapshot = {
              path: entryPath,
              name: file.name,
              size: file.size,
              lastModified: file.lastModified,
              hash,
              syncedAt: Date.now(),
              configId,
            };

            snapshots.push(snapshot);
          } catch (error) {
            console.error(`Failed to read file ${entryPath}:`, error);
          }
        } else if (entry.kind === 'directory') {
          await scanDirectory(entry, entryPath, depth + 1);
        }
      }
    } catch (error) {
      console.error(`Failed to scan directory ${currentPath}:`, error);
    }
  }

  await scanDirectory(handle, basePath, 0);
  return snapshots;
}

/**
 * Scan folder using FileList (fallback for Firefox/mobile)
 * Uses webkitdirectory input or manual file selection
 */
export async function scanFolderWithFileList(
  fileList: FileList,
  configId: string
): Promise<FileSnapshot[]> {
  const snapshots: FileSnapshot[] = [];
  const files = Array.from(fileList);

  // Process files in batches to avoid blocking
  const batchSize = 10;
  for (let i = 0; i < files.length; i += batchSize) {
    const batch = files.slice(i, i + batchSize);
    
    await Promise.all(
      batch.map(async (file) => {
        try {
          // Use metadata hash for faster processing (full hash can be slow)
          // For sync, we'll use full hash only when needed
          const hash = calculateMetadataHash(file);
          const path = (file as any).webkitRelativePath || file.name;

          const snapshot: FileSnapshot = {
            path,
            name: file.name,
            size: file.size,
            lastModified: file.lastModified,
            hash,
            syncedAt: Date.now(),
            configId,
          };

          snapshots.push(snapshot);
        } catch (error) {
          console.error(`Failed to process file ${file.name}:`, error);
        }
      })
    );
  }

  return snapshots;
}

/**
 * Request folder selection (cross-browser)
 * Returns FileList for browsers without File System Access API
 */
export function createFolderInput(): Promise<FileList | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.webkitdirectory = true;
    input.multiple = true;
    input.style.display = 'none';

    input.onchange = (event) => {
      const target = event.target as HTMLInputElement;
      const files = target.files;
      document.body.removeChild(input);
      resolve(files);
    };

    input.oncancel = () => {
      document.body.removeChild(input);
      resolve(null);
    };

    document.body.appendChild(input);
    input.click();
  });
}

/**
 * Compare two file snapshots to detect changes
 */
export function compareSnapshots(
  local: FileSnapshot[],
  remote: FileSnapshot[] | null
): {
  localChanges: FileSnapshot[];
  remoteChanges: FileSnapshot[];
  conflicts: Array<{ local: FileSnapshot; remote: FileSnapshot }>;
  deleted: FileSnapshot[];
} {
  const localMap = new Map(local.map(s => [s.path, s]));
  const remoteMap = remote ? new Map(remote.map(s => [s.path, s])) : new Map();

  const localChanges: FileSnapshot[] = [];
  const remoteChanges: FileSnapshot[] = [];
  const conflicts: Array<{ local: FileSnapshot; remote: FileSnapshot }> = [];
  const deleted: FileSnapshot[] = [];

  // Check local files
  for (const localFile of local) {
    const remoteFile = remoteMap.get(localFile.path);

    if (!remoteFile) {
      // New file locally
      localChanges.push(localFile);
    } else if (localFile.hash !== remoteFile.hash) {
      // File changed
      if (localFile.lastModified > remoteFile.lastModified) {
        // Local is newer - might be a conflict if remote also changed
        const remoteChanged = remoteFile.lastModified > (localFile.syncedAt || 0);
        if (remoteChanged) {
          conflicts.push({ local: localFile, remote: remoteFile });
        } else {
          localChanges.push(localFile);
        }
      } else {
        // Remote is newer
        remoteChanges.push(remoteFile);
      }
    }
    // If hashes match, file is unchanged
  }

  // Check for deleted files (in remote but not in local)
  for (const remoteFile of remote || []) {
    if (!localMap.has(remoteFile.path)) {
      deleted.push(remoteFile);
    }
  }

  return {
    localChanges,
    remoteChanges,
    conflicts,
    deleted,
  };
}

/**
 * Get file from folder handle by path
 */
export async function getFileFromHandle(
  handle: FileSystemDirectoryHandle,
  path: string
): Promise<File | null> {
  const parts = path.split('/').filter(p => p);
  
  try {
    let currentHandle: FileSystemDirectoryHandle | FileSystemFileHandle = handle;
    
    for (let i = 0; i < parts.length - 1; i++) {
      currentHandle = await (currentHandle as FileSystemDirectoryHandle).getDirectoryHandle(parts[i]);
    }
    
    const fileHandle = await (currentHandle as FileSystemDirectoryHandle).getFileHandle(
      parts[parts.length - 1]
    );
    
    return await fileHandle.getFile();
  } catch (error) {
    console.error(`Failed to get file ${path}:`, error);
    return null;
  }
}

