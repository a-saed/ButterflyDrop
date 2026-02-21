/**
 * BDP — OPFS Vault Service (A2)
 *
 * NOTE: TypeScript's DOM lib does not yet include the async iterable protocol
 * for FileSystemDirectoryHandle (.entries(), .values(), .keys()).
 * We use a local cast helper `dirEntries()` to work around this safely.
 *
 * The universal write target for all BDP file data. Wraps the Origin Private
 * File System (OPFS) with:
 *
 *  - Content-Addressable Store (CAS): chunks keyed by SHA-256 hash
 *  - Vault: reconstructed files organised by pair + relative path
 *  - Temp: in-progress transfer staging area
 *  - Web Locks: multi-tab safety for all writes
 *  - Optional chunk compression via CompressionStream (deflate-raw)
 *
 * OPFS path conventions:
 *   bdp/cas/{hash[0:2]}/{hash[2:]}       ← chunk storage (sharded by prefix)
 *   bdp/vault/{pairId}/{path}             ← reconstructed files
 *   bdp/temp/{transferId}/{chunkHash}     ← in-progress transfers
 *
 * Compression protocol:
 *   Each chunk file starts with a 1-byte prefix:
 *     0x00 = raw (uncompressed)
 *     0x01 = deflate-raw compressed
 *   The payload follows immediately after this byte.
 *   Compression is only stored when it saves ≥ 10% of the original size.
 */

import type { PairId, SHA256Hex, VaultFileInfo } from "@/types/bdp";
import { BDP_CONSTANTS } from "@/types/bdp";

// ─────────────────────────────────────────────────────────────────────────────
// Type workaround for FileSystemDirectoryHandle async iteration
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Casts a FileSystemDirectoryHandle to an async iterable of [name, handle] pairs.
 * TypeScript's DOM lib omits this part of the OPFS spec; the cast is safe in
 * all browsers that support OPFS (Chrome 86+, Safari 15.2+, Firefox 111+).
 */
function dirEntries(
  dir: FileSystemDirectoryHandle,
): AsyncIterable<[string, FileSystemHandle]> {
  return dir as unknown as AsyncIterable<[string, FileSystemHandle]>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const PREFIX_RAW = 0x00;
const PREFIX_COMPRESSED = 0x01;

/** Web Lock names */
const LOCK_CAS_WRITE = "bdp-cas-write";
const vaultLock = (pairId: PairId) => `bdp-vault-${pairId}`;

// ─────────────────────────────────────────────────────────────────────────────
// MIME type inference (extension → MIME)
// ─────────────────────────────────────────────────────────────────────────────

const MIME_MAP: Record<string, string> = {
  // Text
  txt: "text/plain",
  md: "text/markdown",
  html: "text/html",
  htm: "text/html",
  css: "text/css",
  csv: "text/csv",
  xml: "text/xml",
  // JavaScript / TypeScript
  js: "application/javascript",
  mjs: "application/javascript",
  ts: "application/typescript",
  tsx: "application/typescript",
  jsx: "application/javascript",
  json: "application/json",
  // Images
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  ico: "image/x-icon",
  bmp: "image/bmp",
  tiff: "image/tiff",
  avif: "image/avif",
  // Audio
  mp3: "audio/mpeg",
  ogg: "audio/ogg",
  wav: "audio/wav",
  flac: "audio/flac",
  aac: "audio/aac",
  // Video
  mp4: "video/mp4",
  webm: "video/webm",
  mkv: "video/x-matroska",
  mov: "video/quicktime",
  avi: "video/x-msvideo",
  // Documents
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  // Archives
  zip: "application/zip",
  gz: "application/gzip",
  tar: "application/x-tar",
  "7z": "application/x-7z-compressed",
  rar: "application/vnd.rar",
  // Fonts
  ttf: "font/ttf",
  otf: "font/otf",
  woff: "font/woff",
  woff2: "font/woff2",
};

function inferMimeType(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return MIME_MAP[ext] ?? "application/octet-stream";
}

function isPreviewable(mimeType: string): boolean {
  return mimeType.startsWith("image/") || mimeType.startsWith("text/");
}

// ─────────────────────────────────────────────────────────────────────────────
// OPFS navigation helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Navigates to (and optionally creates) a nested directory path in OPFS.
 *
 * @param root - Starting FileSystemDirectoryHandle
 * @param segments - Path segments to traverse/create
 * @param create - Whether to create missing directories
 * @returns The handle for the final segment
 * @throws DOMException if a directory doesn't exist and create is false
 */
async function getNestedDir(
  root: FileSystemDirectoryHandle,
  segments: string[],
  create: boolean,
): Promise<FileSystemDirectoryHandle> {
  let current = root;
  for (const segment of segments) {
    current = await current.getDirectoryHandle(segment, { create });
  }
  return current;
}

/**
 * Returns the OPFS root handle (navigator.storage.getDirectory()).
 */
async function getOPFSRoot(): Promise<FileSystemDirectoryHandle> {
  return navigator.storage.getDirectory();
}

// ─────────────────────────────────────────────────────────────────────────────
// Vault initialisation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Initialises the BDP vault directory structure in OPFS.
 *
 * Creates the following directories if they don't already exist:
 *   bdp/
 *   bdp/cas/
 *   bdp/vault/
 *   bdp/temp/
 *
 * Must be called once at app startup before any other vault operations.
 *
 * @throws If OPFS is unavailable or quota is exceeded
 */
export async function initVault(): Promise<void> {
  const root = await getOPFSRoot();
  const bdp = await root.getDirectoryHandle(BDP_CONSTANTS.OPFS_ROOT, {
    create: true,
  });
  await bdp.getDirectoryHandle("cas", { create: true });
  await bdp.getDirectoryHandle("vault", { create: true });
  await bdp.getDirectoryHandle("temp", { create: true });
}

// ─────────────────────────────────────────────────────────────────────────────
// CAS — Content-Addressable Store
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns the directory handle for a CAS shard (the 2-char hash prefix).
 * Sharding limits the number of files per directory, which improves FS perf.
 *
 * @param root - OPFS root
 * @param hash - SHA-256 hex digest
 * @param create - Whether to create missing directories
 */
async function getCASShardDir(
  root: FileSystemDirectoryHandle,
  hash: SHA256Hex,
  create: boolean,
): Promise<FileSystemDirectoryHandle> {
  return getNestedDir(
    root,
    [BDP_CONSTANTS.OPFS_ROOT, "cas", hash.slice(0, 2)],
    create,
  );
}

/**
 * Compresses an ArrayBuffer using deflate-raw.
 * Returns the compressed buffer, or null if compression fails.
 */
async function compressBuffer(data: ArrayBuffer): Promise<ArrayBuffer | null> {
  try {
    const cs = new CompressionStream("deflate-raw");
    const writer = cs.writable.getWriter();
    const reader = cs.readable.getReader();

    void writer.write(new Uint8Array(data));
    void writer.close();

    const chunks: Uint8Array[] = [];
    let totalLength = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      totalLength += value.byteLength;
    }

    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.byteLength;
    }

    return result.buffer;
  } catch {
    return null;
  }
}

/**
 * Decompresses an ArrayBuffer using deflate-raw.
 *
 * @throws If decompression fails (data is corrupt)
 */
async function decompressBuffer(data: ArrayBuffer): Promise<ArrayBuffer> {
  const ds = new DecompressionStream("deflate-raw");
  const writer = ds.writable.getWriter();
  const reader = ds.readable.getReader();

  void writer.write(new Uint8Array(data));
  void writer.close();

  const chunks: Uint8Array[] = [];
  let totalLength = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    totalLength += value.byteLength;
  }

  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return result.buffer;
}

/**
 * Writes a chunk to the CAS under its SHA-256 hash.
 *
 * Optionally compresses the chunk before writing. A 1-byte prefix indicates
 * whether the stored payload is compressed (0x01) or raw (0x00).
 *
 * Acquires the 'bdp-cas-write' Web Lock before writing to prevent
 * concurrent multi-tab writes to the same shard directory.
 *
 * @param hash - SHA-256 hex digest of the raw chunk data
 * @param data - Raw chunk bytes
 * @param alreadyCompressed - If true, skip compression attempt
 */
export async function writeChunk(
  hash: SHA256Hex,
  data: ArrayBuffer,
  alreadyCompressed = false,
): Promise<void> {
  await navigator.locks.request(LOCK_CAS_WRITE, async () => {
    const root = await getOPFSRoot();
    const shardDir = await getCASShardDir(root, hash, true);
    const filename = hash.slice(2);

    let storedPayload: ArrayBuffer;
    let prefix: number;

    if (
      !alreadyCompressed &&
      data.byteLength >= BDP_CONSTANTS.COMPRESSION_THRESHOLD
    ) {
      const compressed = await compressBuffer(data);
      if (
        compressed !== null &&
        compressed.byteLength <
          data.byteLength * BDP_CONSTANTS.COMPRESSION_THRESHOLD
      ) {
        storedPayload = compressed;
        prefix = PREFIX_COMPRESSED;
      } else {
        storedPayload = data;
        prefix = PREFIX_RAW;
      }
    } else {
      storedPayload = data;
      prefix = PREFIX_RAW;
    }

    // Prepend the 1-byte prefix
    const finalBuffer = new Uint8Array(1 + storedPayload.byteLength);
    finalBuffer[0] = prefix;
    finalBuffer.set(new Uint8Array(storedPayload), 1);

    const fileHandle = await shardDir.getFileHandle(filename, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(finalBuffer);
    await writable.close();
  });
}

/**
 * Reads a chunk from the CAS by its SHA-256 hash.
 * Automatically decompresses if the stored payload is compressed.
 *
 * @param hash - SHA-256 hex digest of the chunk
 * @returns Raw (decompressed) chunk data
 * @throws DOMException('NotFoundError') if the chunk doesn't exist
 */
export async function readChunk(hash: SHA256Hex): Promise<ArrayBuffer> {
  const root = await getOPFSRoot();
  const shardDir = await getCASShardDir(root, hash, false);
  const fileHandle = await shardDir.getFileHandle(hash.slice(2));
  const file = await fileHandle.getFile();
  const raw = await file.arrayBuffer();

  if (raw.byteLength === 0) {
    throw new Error(`BDP: CAS chunk ${hash} is empty`);
  }

  const view = new Uint8Array(raw);
  const prefix = view[0];
  const payload = raw.slice(1);

  if (prefix === PREFIX_COMPRESSED) {
    return decompressBuffer(payload);
  }

  return payload;
}

/**
 * Checks whether a chunk exists in the CAS.
 *
 * @param hash - SHA-256 hex digest
 * @returns true if the chunk is present, false otherwise
 */
export async function hasChunk(hash: SHA256Hex): Promise<boolean> {
  try {
    const root = await getOPFSRoot();
    const shardDir = await getCASShardDir(root, hash, false);
    await shardDir.getFileHandle(hash.slice(2));
    return true;
  } catch (err) {
    if (err instanceof DOMException && err.name === "NotFoundError") {
      return false;
    }
    throw err;
  }
}

/**
 * Removes a chunk from the CAS.
 * No-op if the chunk doesn't exist.
 *
 * @param hash - SHA-256 hex digest of the chunk to delete
 */
export async function deleteChunk(hash: SHA256Hex): Promise<void> {
  try {
    const root = await getOPFSRoot();
    const shardDir = await getCASShardDir(root, hash, false);
    await shardDir.removeEntry(hash.slice(2));
  } catch (err) {
    if (err instanceof DOMException && err.name === "NotFoundError") {
      return; // already gone — that's fine
    }
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// File reconstruction
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reconstructs a complete file from an ordered list of CAS chunk hashes.
 *
 * Reads each chunk from the CAS in order and concatenates them into a Blob.
 * The Blob MIME type is set to application/octet-stream; callers that know
 * the file's type should set it themselves after reconstruction.
 *
 * @param chunkHashes - Ordered SHA-256 hashes for each chunk
 * @returns Reconstructed file as a Blob
 * @throws If any chunk is missing from the CAS
 */
export async function reconstructFile(chunkHashes: SHA256Hex[]): Promise<Blob> {
  const parts: ArrayBuffer[] = [];
  for (const hash of chunkHashes) {
    parts.push(await readChunk(hash));
  }
  return new Blob(parts);
}

// ─────────────────────────────────────────────────────────────────────────────
// Vault — reconstructed files by pair
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Splits a vault-relative path into directory segments + filename.
 *
 * @param path - Unix-style path: "src/utils/helper.ts"
 * @returns [dirSegments, filename]
 */
function splitVaultPath(path: string): [string[], string] {
  const parts = path.split("/");
  const filename = parts.pop() ?? path;
  return [parts, filename];
}

/**
 * Navigates to (and optionally creates) the directory for a vault path.
 *
 * @param root - OPFS root
 * @param pairId - Pair identifier
 * @param dirSegments - Directory path segments (no filename)
 * @param create - Whether to create missing directories
 */
async function getVaultDir(
  root: FileSystemDirectoryHandle,
  pairId: PairId,
  dirSegments: string[],
  create: boolean,
): Promise<FileSystemDirectoryHandle> {
  return getNestedDir(
    root,
    [BDP_CONSTANTS.OPFS_ROOT, "vault", pairId, ...dirSegments],
    create,
  );
}

/**
 * Writes a reconstructed file to the vault.
 *
 * Acquires the pair-specific vault lock before writing to prevent
 * concurrent writes to the same pair's vault from multiple tabs.
 *
 * @param pairId - Which sync pair this file belongs to
 * @param path - Relative path within the sync root (e.g. "src/App.tsx")
 * @param chunkHashes - Ordered SHA-256 hashes for each chunk of this file
 */
export async function writeFileToVault(
  pairId: PairId,
  path: string,
  chunkHashes: SHA256Hex[],
): Promise<void> {
  await navigator.locks.request(vaultLock(pairId), async () => {
    const blob = await reconstructFile(chunkHashes);
    const root = await getOPFSRoot();
    const [dirSegments, filename] = splitVaultPath(path);
    const dir = await getVaultDir(root, pairId, dirSegments, true);

    const fileHandle = await dir.getFileHandle(filename, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(blob);
    await writable.close();
  });
}

/**
 * Reads a file from the vault as a Blob.
 *
 * @param pairId - Which sync pair to look in
 * @param path - Relative path within the sync root
 * @returns The file Blob, or null if not found
 */
export async function readFileFromVault(
  pairId: PairId,
  path: string,
): Promise<Blob | null> {
  try {
    const root = await getOPFSRoot();
    const [dirSegments, filename] = splitVaultPath(path);
    const dir = await getVaultDir(root, pairId, dirSegments, false);
    const fileHandle = await dir.getFileHandle(filename);
    return fileHandle.getFile();
  } catch (err) {
    if (err instanceof DOMException && err.name === "NotFoundError") {
      return null;
    }
    throw err;
  }
}

/**
 * Deletes a file from the vault.
 * No-op if the file doesn't exist.
 *
 * @param pairId - Which sync pair the file belongs to
 * @param path - Relative path within the sync root
 */
export async function deleteFromVault(
  pairId: PairId,
  path: string,
): Promise<void> {
  try {
    const root = await getOPFSRoot();
    const [dirSegments, filename] = splitVaultPath(path);
    const dir = await getVaultDir(root, pairId, dirSegments, false);
    await dir.removeEntry(filename);
  } catch (err) {
    if (err instanceof DOMException && err.name === "NotFoundError") {
      return;
    }
    throw err;
  }
}

/**
 * Recursively lists all files in a pair's vault directory.
 *
 * @param pairId - Which sync pair to list
 * @returns Array of VaultFileInfo for every file in the vault
 */
export async function listVaultFiles(pairId: PairId): Promise<VaultFileInfo[]> {
  try {
    const root = await getOPFSRoot();
    const vaultRoot = await getNestedDir(
      root,
      [BDP_CONSTANTS.OPFS_ROOT, "vault", pairId],
      false,
    );
    const results: VaultFileInfo[] = [];
    await walkDir(vaultRoot, "", results);
    return results;
  } catch (err) {
    if (err instanceof DOMException && err.name === "NotFoundError") {
      return [];
    }
    throw err;
  }
}

/**
 * Recursively walks a directory handle, collecting VaultFileInfo entries.
 *
 * @param dir - Current directory handle
 * @param prefix - Relative path prefix accumulated so far
 * @param results - Accumulator array
 */
async function walkDir(
  dir: FileSystemDirectoryHandle,
  prefix: string,
  results: VaultFileInfo[],
): Promise<void> {
  for await (const [name, handle] of dirEntries(dir)) {
    const relativePath = prefix ? `${prefix}/${name}` : name;

    if (handle.kind === "directory") {
      await walkDir(handle as FileSystemDirectoryHandle, relativePath, results);
    } else {
      const fileHandle = handle as FileSystemFileHandle;
      const file = await fileHandle.getFile();
      const mimeType = inferMimeType(name);

      results.push({
        path: relativePath,
        name,
        size: file.size,
        mtime: file.lastModified,
        mimeType,
        previewable: isPreviewable(mimeType),
        available: true, // file is present in vault = available
        conflicted: false, // caller must overlay this from IDB conflict records
      });
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Vault size
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns the total byte size of all chunks in the CAS.
 *
 * Note: this counts stored bytes (possibly compressed), not original file sizes.
 * Use BDPFileEntry.size fields for logical file sizes.
 *
 * @returns Total CAS size in bytes
 */
export async function getVaultSize(): Promise<number> {
  try {
    const root = await getOPFSRoot();
    const casRoot = await getNestedDir(
      root,
      [BDP_CONSTANTS.OPFS_ROOT, "cas"],
      false,
    );
    let total = 0;
    for await (const [, shardHandle] of dirEntries(casRoot)) {
      if (shardHandle.kind !== "directory") continue;
      const shardDir = shardHandle as FileSystemDirectoryHandle;
      for await (const [, chunkHandle] of dirEntries(shardDir)) {
        if (chunkHandle.kind !== "file") continue;
        const file = await (chunkHandle as FileSystemFileHandle).getFile();
        total += file.size;
      }
    }
    return total;
  } catch (err) {
    if (err instanceof DOMException && err.name === "NotFoundError") {
      return 0;
    }
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Temp staging area
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Writes a chunk to the temp staging area for an in-progress transfer.
 * Used to stage chunks before verifying the full file hash.
 *
 * @param transferId - The in-flight transfer identifier
 * @param chunkHash - SHA-256 of this specific chunk
 * @param data - Raw chunk data
 */
export async function writeTempChunk(
  transferId: string,
  chunkHash: SHA256Hex,
  data: ArrayBuffer,
): Promise<void> {
  const root = await getOPFSRoot();
  const tempDir = await getNestedDir(
    root,
    [BDP_CONSTANTS.OPFS_ROOT, "temp", transferId],
    true,
  );
  const fileHandle = await tempDir.getFileHandle(chunkHash, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(data);
  await writable.close();
}

/**
 * Reads a staged chunk from the temp area.
 *
 * @param transferId - The in-flight transfer identifier
 * @param chunkHash - SHA-256 of the chunk
 * @returns Raw chunk data
 * @throws DOMException('NotFoundError') if the chunk hasn't been staged yet
 */
export async function readTempChunk(
  transferId: string,
  chunkHash: SHA256Hex,
): Promise<ArrayBuffer> {
  const root = await getOPFSRoot();
  const tempDir = await getNestedDir(
    root,
    [BDP_CONSTANTS.OPFS_ROOT, "temp", transferId],
    false,
  );
  const fileHandle = await tempDir.getFileHandle(chunkHash);
  const file = await fileHandle.getFile();
  return file.arrayBuffer();
}

/**
 * Deletes the entire staging directory for a completed or cancelled transfer.
 * Should be called after all chunks have been committed to the CAS.
 *
 * @param transferId - The in-flight transfer identifier
 */
export async function cleanupTempTransfer(transferId: string): Promise<void> {
  try {
    const root = await getOPFSRoot();
    const tempRoot = await getNestedDir(
      root,
      [BDP_CONSTANTS.OPFS_ROOT, "temp"],
      false,
    );
    await tempRoot.removeEntry(transferId, { recursive: true });
  } catch (err) {
    if (err instanceof DOMException && err.name === "NotFoundError") {
      return;
    }
    throw err;
  }
}
