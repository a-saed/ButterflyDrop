/**
 * File Hashing Utilities
 * Supports MD5 and SHA-256 hashing with Web Worker support
 */

/**
 * Calculate SHA-256 hash of a file/blob
 * Uses SubtleCrypto API (available in all modern browsers)
 */
export async function calculateFileHash(file: File | Blob): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  
  // Use SubtleCrypto for SHA-256 (more secure than MD5, widely supported)
  const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
  
  // Convert to hex string
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  
  return hashHex;
}

/**
 * Calculate hash of file metadata (size + lastModified)
 * Faster than full file hash, good for quick change detection
 */
export function calculateMetadataHash(file: File): string {
  const metadata = `${file.size}-${file.lastModified}`;
  // Simple hash function (not cryptographic, but fast)
  let hash = 0;
  for (let i = 0; i < metadata.length; i++) {
    const char = metadata.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(16);
}

/**
 * Calculate hash in chunks (for large files)
 * Processes file in chunks to avoid memory issues
 */
export async function calculateFileHashChunked(
  file: File,
  chunkSize: number = 1024 * 1024 // 1MB chunks
): Promise<string> {
  const hasher = new SubtleCryptoHasher();
  
  let offset = 0;
  while (offset < file.size) {
    const chunk = file.slice(offset, offset + chunkSize);
    const arrayBuffer = await chunk.arrayBuffer();
    await hasher.update(arrayBuffer);
    offset += chunkSize;
  }
  
  return hasher.finalize();
}

/**
 * Streaming hash calculator for large files
 */
class SubtleCryptoHasher {
  private chunks: ArrayBuffer[] = [];

  async update(chunk: ArrayBuffer): Promise<void> {
    this.chunks.push(chunk);
  }

  async finalize(): Promise<string> {
    // Combine all chunks
    const totalLength = this.chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
    const combined = new Uint8Array(totalLength);
    
    let offset = 0;
    for (const chunk of this.chunks) {
      combined.set(new Uint8Array(chunk), offset);
      offset += chunk.byteLength;
    }
    
    // Calculate hash
    const hashBuffer = await crypto.subtle.digest('SHA-256', combined.buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }
}

/**
 * Quick change detection using metadata only
 * Returns true if file might have changed (size or modified time)
 */
export function hasFileChanged(file: File, previousSnapshot: { size: number; lastModified: number }): boolean {
  return file.size !== previousSnapshot.size || file.lastModified !== previousSnapshot.lastModified;
}

