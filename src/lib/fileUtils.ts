import type { FileMetadata, FolderMetadata } from '@/types/transfer'

// Optimal chunk size for WebRTC DataChannel
// 16 KB is the sweet spot: fast enough, small enough to avoid drops
const CHUNK_SIZE = 16384 // 16 KB

/**
 * Generate a UUID - uses crypto.randomUUID if available, otherwise falls back to a custom implementation
 * Compatible with older browsers and mobile devices
 */
function generateUUID(): string {
  // Use crypto.randomUUID if available (modern browsers)
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    try {
      return crypto.randomUUID();
    } catch {
      // Fall through to fallback
    }
  }
  
  // Fallback: Generate UUID v4 manually
  // Format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Get chunk size for file transfer
 */
export function getChunkSize(): number {
  return CHUNK_SIZE
}

/**
 * Format file size to human-readable string
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`
}

/**
 * Calculate transfer speed (bytes per second)
 */
export function calculateSpeed(
  bytesTransferred: number,
  startTime: number
): number {
  const elapsed = (Date.now() - startTime) / 1000 // seconds
  return elapsed > 0 ? bytesTransferred / elapsed : 0
}

/**
 * Calculate ETA in seconds
 */
export function calculateETA(
  bytesRemaining: number,
  speed: number
): number {
  return speed > 0 ? Math.ceil(bytesRemaining / speed) : 0
}

/**
 * Create file metadata from File object
 */
export function createFileMetadata(
  file: File,
  id?: string,
  path?: string
): FileMetadata {
  return {
    id: id || generateUUID(),
    name: file.name,
    size: file.size,
    type: file.type || 'application/octet-stream',
    lastModified: file.lastModified,
    path: path || file.name,
  }
}

/**
 * Create folder metadata from FileList
 */
export function createFolderMetadata(
  files: FileList,
  folderName: string = 'root'
): FolderMetadata {
  const fileMetadata: FileMetadata[] = []
  const folderMap = new Map<string, FolderMetadata>()

  // Process all files
  Array.from(files).forEach((file) => {
    const pathParts = file.webkitRelativePath.split('/')
    const fileName = pathParts[pathParts.length - 1]
    const folderPath = pathParts.slice(0, -1).join('/')

    const fileMeta: FileMetadata = {
      id: generateUUID(),
      name: fileName,
      size: file.size,
      type: file.type || 'application/octet-stream',
      lastModified: file.lastModified,
      path: file.webkitRelativePath,
    }

    if (folderPath === '') {
      // Root level file
      fileMetadata.push(fileMeta)
    } else {
      // File in subfolder
      if (!folderMap.has(folderPath)) {
        const pathParts = folderPath.split('/')
        const folderMeta: FolderMetadata = {
          name: pathParts[pathParts.length - 1],
          path: folderPath,
          files: [],
          folders: [],
        }
        folderMap.set(folderPath, folderMeta)
      }
      folderMap.get(folderPath)!.files.push(fileMeta)
    }
  })

  // Build folder hierarchy
  const rootFolders: FolderMetadata[] = []
  folderMap.forEach((folder) => {
    const parentPath = folder.path.split('/').slice(0, -1).join('/')
    if (parentPath === '') {
      rootFolders.push(folder)
    } else {
      const parent = folderMap.get(parentPath)
      if (parent) {
        parent.folders.push(folder)
      } else {
        rootFolders.push(folder)
      }
    }
  })

  return {
    name: folderName,
    path: '',
    files: fileMetadata,
    folders: rootFolders,
  }
}

/**
 * Sanitize file name for safe transfer
 */
export function sanitizeFileName(fileName: string): string {
  const unsafe = '<>:"/\\|?*';
  const cleaned = Array.from(fileName)
    .map((ch) => {
      const code = ch.charCodeAt(0);
      if (code < 32 || unsafe.includes(ch)) {
        return '_';
      }
      return ch;
    })
    .join('');

  return cleaned.replace(/^\.+/, '').trim(); // Remove leading dots and trim
}

/**
 * Read file as ArrayBuffer in chunks
 */
export async function* readFileInChunks(
  file: File,
  chunkSize: number = CHUNK_SIZE
): AsyncGenerator<ArrayBuffer, void, unknown> {
  let offset = 0

  while (offset < file.size) {
    const chunk = file.slice(offset, offset + chunkSize)
    const buffer = await chunk.arrayBuffer()
    yield buffer
    offset += chunkSize
  }
}

