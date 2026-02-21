/**
 * Butterfly Delta Protocol (BDP) — Type Definitions
 *
 * A novel P2P file synchronization protocol purpose-built for the browser.
 *
 * Core innovations:
 *  1. OPFS as universal sync vault (zero permission, all browsers)
 *  2. Encrypted delta relay (async index propagation, server-blind)
 *  3. ECDH shared key from QR pair setup
 *  4. Merkle tree index (O(changed × log n) diff)
 *  5. Content-Addressable Chunk Store in OPFS (resumable + dedup)
 *  6. Vector clock CRDTs per file (mathematical conflict detection)
 *  7. Native CompressionStream in transfer pipeline
 *  8. Web Locks for multi-tab safety
 *  9. Service Worker delta push (Chrome)
 * 10. Progressive permission model (Tier 0–2)
 */

// ─────────────────────────────────────────────────────────────────────────────
// § 1. Primitives & Branded Types
// ─────────────────────────────────────────────────────────────────────────────

/** SHA-256 hex digest (64 lowercase hex chars) */
export type SHA256Hex = string & { readonly __brand: "SHA256Hex" };

/** nanoid(21) — device identity */
export type DeviceId = string & { readonly __brand: "DeviceId" };

/** nanoid(32) — shared group secret, doubles as auth token */
export type PairId = string & { readonly __brand: "PairId" };

/** nanoid(21) — unique message/request identifier */
export type MsgId = string & { readonly __brand: "MsgId" };

/** nanoid(21) — unique in-flight transfer identifier */
export type TransferId = string & { readonly __brand: "TransferId" };

/**
 * Vector clock: a map from DeviceId to monotonic sequence number.
 * Used for CRDT-based conflict detection.
 *
 * Semantics:
 *   clock[device] = N  means: "I have seen N changes from <device>"
 */
export type VectorClock = Readonly<Record<DeviceId, number>>;

// ─────────────────────────────────────────────────────────────────────────────
// § 2. Device Identity
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Persistent local device record — stored in IndexedDB under key 'self'.
 * Created once on first app launch, never changes (except deviceName).
 */
export interface BDPDevice {
  deviceId: DeviceId;

  /** Human-readable label shown to peers, e.g. "ubuntu-firefox" */
  deviceName: string;

  /**
   * Monotonically increasing counter, incremented on EVERY local file change.
   * Used as the 'seq' field in FileIndexEntry and for delta relay queries.
   */
  localSeq: number;

  /**
   * X25519 public key — exported as base64, shared during pairing.
   * The private key lives in the browser's non-extractable CryptoKey store.
   */
  publicKeyB64: string;

  /** Detected browser capabilities — refreshed on each app launch */
  capabilities: BDPCapabilities;

  /** When this device record was first created */
  createdAt: number;
}

export interface BDPCapabilities {
  /** showDirectoryPicker() is available (Chrome/Edge desktop) */
  hasFSAPI: boolean;

  /** navigator.storage.getDirectory() — always true on modern browsers */
  hasOPFS: boolean;

  /** Can write back to the real filesystem via FileSystemWritableFileStream */
  canWriteRealFS: boolean;

  /** ServiceWorkerRegistration.sync — Background Sync API */
  hasBackgroundSync: boolean;

  /** FileSystemObserver (experimental, Chrome only) */
  hasFileObserver: boolean;

  /** Supported CompressionStream algorithms */
  compressionAlgos: ReadonlyArray<"deflate-raw" | "gzip" | "deflate">;
}

// ─────────────────────────────────────────────────────────────────────────────
// § 3. Sync Pair
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A sync relationship between this device and one or more peers.
 * Persisted in IndexedDB. The pairId is the shared secret — treat it like
 * a password. Transmitted only via QR code or direct link.
 */
export interface SyncPair {
  pairId: PairId;

  /** All devices participating in this pair (including self) */
  devices: BDPPeerInfo[];

  /** Local folder configuration */
  localFolder: BDPLocalFolder;

  direction: SyncDirection;
  conflictStrategy: ConflictStrategy;

  /**
   * Gitignore-style glob patterns for selective sync.
   * Include patterns are evaluated first, then excludes are applied.
   * Empty includePatterns = include everything.
   */
  includePatterns: string[];
  excludePatterns: string[];

  /** Files larger than this are skipped. Default: 500MB */
  maxFileSizeBytes: number;

  createdAt: number;
  lastSyncedAt: number | null;

  /** Timestamp of the last relay delta we fetched */
  lastRelayFetchedAt: number | null;

  /** Current Merkle root of our local index for this pair */
  localMerkleRoot: SHA256Hex | null;

  /**
   * The last Merkle roots we know about for each remote device.
   * Used to quickly detect "nothing changed" without a full diff walk.
   */
  knownRemoteRoots: Record<DeviceId, SHA256Hex>;
}

export type SyncDirection = "bidirectional" | "upload-only" | "download-only";

export type ConflictStrategy =
  | "last-write-wins"
  | "manual"
  | "local-wins"
  | "remote-wins";

export interface BDPLocalFolder {
  /** Display name shown in UI */
  name: string;

  /**
   * Chrome/Edge: persistent FileSystemDirectoryHandle stored in IndexedDB.
   * Requires permission re-verification on each app load.
   * null on Firefox/Safari.
   */
  handle: FileSystemDirectoryHandle | null;

  /**
   * Path inside the OPFS vault for this pair.
   * Always present. Format: `bdp/vault/{pairId}/`
   */
  opfsPath: string;

  /**
   * Whether to write received files through to the real filesystem
   * (requires hasFSAPI + handle to be non-null).
   */
  useRealFS: boolean;
}

export interface BDPPeerInfo {
  deviceId: DeviceId;
  deviceName: string;

  /** base64-encoded X25519 public key */
  publicKeyB64: string;

  lastSeenAt: number | null;

  /**
   * The ECDH-derived AES-256-GCM shared key for this peer.
   * NOT stored in IndexedDB (non-extractable CryptoKey).
   * Re-derived from publicKey on each session.
   */
  sharedKey?: CryptoKey;
}

// ─────────────────────────────────────────────────────────────────────────────
// § 4. Merkle Index
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A single file's state in the index — the core data unit of Chrysalis.
 *
 * Stored in IndexedDB under the 'fileIndex' object store.
 * Keyed by [pairId, path].
 *
 * The vectorClock enables CRDT-style merging: any two replicas of the index
 * can always be merged into a consistent result without a central coordinator.
 */
export interface BDPFileEntry {
  pairId: PairId;

  /**
   * Relative path from the sync root.
   * Always uses '/' as separator, always UTF-8 NFC normalized.
   * Example: "src/utils/fileHelper.ts"
   */
  path: string;

  /** SHA-256 of the full file content */
  hash: SHA256Hex;

  size: number;

  /** Last modified timestamp (ms since epoch) */
  mtime: number;

  /**
   * Ordered list of SHA-256 hashes for each 256KB chunk.
   * The last chunk may be smaller.
   * Used for the Content-Addressable Store and rsync-like delta transfer.
   */
  chunkHashes: SHA256Hex[];

  /** Chunk size in bytes used for this file. Default: 262144 (256KB) */
  chunkSize: number;

  /**
   * Vector clock at the time of last modification.
   * Enables mathematical conflict detection:
   *   A > B  →  A dominates (no conflict)
   *   concurrent  →  conflict
   */
  vectorClock: VectorClock;

  /** Which device last modified this file */
  deviceId: DeviceId;

  /**
   * This device's localSeq at the time of modification.
   * Used for efficient delta queries: "give me all entries with seq > N"
   */
  seq: number;

  /**
   * true = file has been deleted.
   * We keep tombstones forever to propagate deletes correctly via relay.
   * Never delete tombstone entries from the index — only GC after all
   * known peers have acknowledged the delete.
   */
  tombstone: boolean;
  tombstoneAt?: number;

  /**
   * Hint: is this file type already compressed?
   * If true, skip compression during transfer.
   * Derived from MIME type / extension.
   */
  alreadyCompressed: boolean;
}

/**
 * A node in the Merkle tree.
 * Stored in IndexedDB under the 'merkleNodes' object store.
 * Keyed by [pairId, nodePath].
 *
 * The tree is structured to mirror the filesystem hierarchy.
 * Internal nodes hash their children's hashes.
 * Leaf nodes reference a BDPFileEntry (their hash == fileEntry.hash).
 */
export interface BDPMerkleNode {
  pairId: PairId;

  /**
   * Path of this node within the tree.
   * '' = root, 'src' = the node for the src/ directory.
   */
  nodePath: string;

  /**
   * SHA-256 of all children's (sorted) hashes concatenated.
   * For leaf nodes: SHA-256 of the file content (== BDPFileEntry.hash).
   */
  hash: SHA256Hex;

  /** child segment name → child node hash */
  childHashes: Record<string, SHA256Hex>;

  /** Number of direct children */
  childCount: number;

  updatedAt: number;
}

/**
 * The current root state of the Merkle index for a pair.
 * Stored in IndexedDB under the 'indexRoots' object store, keyed by pairId.
 */
export interface BDPIndexRoot {
  pairId: PairId;
  deviceId: DeviceId;

  /** The Merkle root hash — single value fingerprinting the entire folder */
  rootHash: SHA256Hex;

  /** Total number of files in the index (including tombstones) */
  entryCount: number;

  /** Highest seq number across all entries in this index */
  maxSeq: number;

  /**
   * A random ID that changes when the index is reset from scratch.
   * Peers use this to detect "this is a fresh index, do a full sync"
   * vs "I can do a delta sync from seq N."
   */
  indexId: string;

  computedAt: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// § 5. Content-Addressable Chunk Store (CAS)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Metadata for a chunk in the CAS.
 * Stored in IndexedDB under the 'casIndex' object store, keyed by chunkHash.
 * Actual bytes live in OPFS at: bdp/cas/{hash[0:2]}/{hash[2:]}
 */
export interface CASChunk {
  /** SHA-256 of the UNCOMPRESSED chunk content */
  hash: SHA256Hex;

  /** Whether the stored bytes in OPFS are compressed */
  storedCompressed: boolean;

  /** Original (uncompressed) size in bytes */
  originalSize: number;

  /** Actual stored size in bytes (may be smaller if compressed) */
  storedSize: number;

  /**
   * Number of BDPFileEntry.chunkHashes arrays referencing this chunk.
   * When refCount reaches 0, the chunk is eligible for GC.
   */
  refCount: number;

  createdAt: number;
  lastAccessedAt: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// § 6. Sync Plan
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The computed list of actions to take after comparing local and remote indexes.
 * Output of SyncPlanner, input to the transfer phase.
 */
export interface BDPSyncPlan {
  pairId: PairId;
  remotePeerDeviceId: DeviceId;

  /** Files that exist locally but not remotely, or our version is newer */
  upload: BDPFileEntry[];

  /** Files that exist remotely but not locally, or remote version is newer */
  download: BDPFileEntry[];

  /**
   * Files modified concurrently (vector clocks are incomparable).
   * Each entry contains both local and remote versions.
   */
  conflicts: BDPConflict[];

  /** Files with identical hashes on both sides — no action needed */
  unchangedCount: number;

  computedAt: number;
}

export interface BDPConflict {
  path: string;
  local: BDPFileEntry;
  remote: BDPFileEntry;

  /**
   * The auto-resolution computed from the pair's conflictStrategy.
   * 'none' = manual resolution required.
   */
  autoResolution: ConflictResolution | "none";
}

export type ConflictResolution = "keep-local" | "keep-remote" | "keep-both";

// ─────────────────────────────────────────────────────────────────────────────
// § 7. Protocol Wire Frames
// ─────────────────────────────────────────────────────────────────────────────

/**
 * All frames share this common header.
 * The 'cp: true' flag is a fast type discriminant to distinguish
 * Butterfly Delta Protocol frames from other WebRTC DataChannel messages
 * (e.g. existing file transfer messages).
 */
export interface BDPFrameHeader {
  readonly cp: true;
  readonly v: 1;
  type: BDPFrameType;
  pairId: PairId;
  msgId: MsgId;
  fromDeviceId: DeviceId;
  /** Wall-clock ms at time of send — NOT used for ordering, only for display */
  ts: number;
}

export type BDPFrameType =
  | "BDP_HELLO"
  | "BDP_MERKLE"
  | "BDP_INDEX_REQUEST"
  | "BDP_INDEX_RESPONSE"
  | "BDP_CHUNK_REQUEST"
  | "BDP_CHUNK"
  | "BDP_ACK"
  | "BDP_CONFLICT"
  | "BDP_CONFLICT_RESOLUTION"
  | "BDP_DONE"
  | "BDP_ERROR"
  | "BDP_PING"
  | "BDP_PONG";

// ── 7.1 Handshake ────────────────────────────────────────────────────────────

export interface BDPHelloFrame extends BDPFrameHeader {
  type: "BDP_HELLO";
  payload: {
    deviceName: string;
    capabilities: BDPCapabilities;
    /** base64-encoded X25519 public key */
    publicKeyB64: string;
    pairs: BDPHelloPairInfo[];
  };
}

export interface BDPHelloPairInfo {
  pairId: PairId;
  /** Current Merkle root of sender's local index for this pair */
  merkleRoot: SHA256Hex | null;
  /** Highest seq number in sender's index */
  maxSeq: number;
  /**
   * Unique index ID — changes when the index is reset from scratch.
   * Receiver uses this to decide: delta sync (same indexId) or full sync.
   */
  indexId: string;
}

// ── 7.2 Merkle Tree Exchange ──────────────────────────────────────────────────

/**
 * Used during the Merkle diff walk.
 * Both peers walk their trees in parallel, exchanging subtree hashes
 * until they identify exactly which leaf entries diverge.
 */
export interface BDPMerkleFrame extends BDPFrameHeader {
  type: "BDP_MERKLE";
  payload: {
    /** Path being described. '' = root. */
    nodePath: string;
    nodeHash: SHA256Hex;
    /** child segment → child hash */
    childHashes: Record<string, SHA256Hex>;
  };
}

// ── 7.3 Index Exchange ────────────────────────────────────────────────────────

export interface BDPIndexRequestFrame extends BDPFrameHeader {
  type: "BDP_INDEX_REQUEST";
  payload: {
    /**
     * 0 = full index (first sync or index reset)
     * N = delta since seq N (reconnect with shared history)
     */
    sinceSeq: number;
    /** Optional: only return entries for these specific paths */
    paths?: string[];
  };
}

export interface BDPIndexResponseFrame extends BDPFrameHeader {
  type: "BDP_INDEX_RESPONSE";
  payload: {
    entries: BDPFileEntry[];
    /**
     * false = more entries are coming (chunked for large indexes).
     * Receiver should accumulate until isComplete = true.
     */
    isComplete: boolean;
    totalEntries: number;
    /** The sender's current maxSeq (helps receiver plan delta queries) */
    senderMaxSeq: number;
  };
}

// ── 7.4 File Transfer ─────────────────────────────────────────────────────────

export interface BDPChunkRequestFrame extends BDPFrameHeader {
  type: "BDP_CHUNK_REQUEST";
  payload: {
    transferId: TransferId;
    path: string;
    /**
     * Chunk hashes we ALREADY HAVE in our local CAS.
     * The sender will skip these — rsync-like block deduplication.
     */
    haveChunks: SHA256Hex[];
    /**
     * Chunk hashes we NEED from the sender.
     * Ordered by chunk position in the file.
     */
    needChunks: SHA256Hex[];
    totalChunks: number;
  };
}

/**
 * Binary frame — NOT pure JSON.
 * Wire format:
 *   [headerLength: uint16 big-endian]
 *   [header: JSON bytes of BDPChunkFrameHeader]
 *   [data: raw ArrayBuffer (chunk bytes, possibly compressed)]
 *
 * This avoids base64 overhead on binary chunk data.
 */
export interface BDPChunkFrame extends BDPFrameHeader {
  type: "BDP_CHUNK";
  payload: {
    transferId: TransferId;
    /** SHA-256 of the UNCOMPRESSED chunk content */
    chunkHash: SHA256Hex;
    /** Zero-based index of this chunk in the file's chunkHashes array */
    chunkIndex: number;
    isLast: boolean;
    /** Is the data portion of this frame compressed? */
    compressed: boolean;
    /** Original (uncompressed) size — needed for decompression */
    originalSize: number;
  };
  // data: ArrayBuffer  — follows the JSON header in the binary frame
}

export interface BDPAckFrame extends BDPFrameHeader {
  type: "BDP_ACK";
  payload: {
    transferId: TransferId;
    path: string;
    status: "ok" | "hash_mismatch" | "write_error";
    /** Populated when status === 'hash_mismatch' */
    receivedHash?: SHA256Hex;
    /** Populated when status === 'write_error' */
    errorMessage?: string;
  };
}

// ── 7.5 Conflict Handling ─────────────────────────────────────────────────────

export interface BDPConflictFrame extends BDPFrameHeader {
  type: "BDP_CONFLICT";
  payload: {
    path: string;
    localEntry: BDPFileEntry;
    remoteEntry: BDPFileEntry;
    autoResolution: ConflictResolution | "none";
  };
}

export interface BDPConflictResolutionFrame extends BDPFrameHeader {
  type: "BDP_CONFLICT_RESOLUTION";
  payload: {
    path: string;
    resolution: ConflictResolution;
    /**
     * When resolution === 'keep-both', the losing version is preserved
     * under this alternative path. Format:
     *   "path/to/file.md.{deviceName}.conflict.{timestamp}"
     */
    renamedPath?: string;
  };
}

// ── 7.6 Session Control ───────────────────────────────────────────────────────

export interface BDPDoneFrame extends BDPFrameHeader {
  type: "BDP_DONE";
  payload: {
    stats: BDPSyncStats;
    /** The Merkle root after the sync completed */
    newMerkleRoot: SHA256Hex;
    /** The new maxSeq after the sync completed */
    newMaxSeq: number;
  };
}

export interface BDPErrorFrame extends BDPFrameHeader {
  type: "BDP_ERROR";
  payload: {
    code: BDPErrorCode;
    message: string;
    /** If false, the session is terminated and must be restarted */
    recoverable: boolean;
  };
}

export type BDPErrorCode =
  | "PAIR_NOT_FOUND"
  | "CRYPTO_ERROR"
  | "INDEX_CORRUPT"
  | "STORAGE_FULL"
  | "PERMISSION_DENIED"
  | "TRANSFER_FAILED"
  | "CONFLICT_UNRESOLVED"
  | "VERSION_MISMATCH"
  | "RATE_LIMITED"
  | "TIMEOUT";

export interface BDPPingFrame extends BDPFrameHeader {
  type: "BDP_PING";
  payload: { nonce: string };
}

export interface BDPPongFrame extends BDPFrameHeader {
  type: "BDP_PONG";
  payload: { nonce: string; latencyHint?: number };
}

/** Union of all valid CP frames */
export type BDPFrame =
  | BDPHelloFrame
  | BDPMerkleFrame
  | BDPIndexRequestFrame
  | BDPIndexResponseFrame
  | BDPChunkRequestFrame
  | BDPChunkFrame
  | BDPAckFrame
  | BDPConflictFrame
  | BDPConflictResolutionFrame
  | BDPDoneFrame
  | BDPErrorFrame
  | BDPPingFrame
  | BDPPongFrame;

// ─────────────────────────────────────────────────────────────────────────────
// § 8. Delta Relay
// ─────────────────────────────────────────────────────────────────────────────

/**
 * What the signaling server stores — it cannot read the encrypted payload.
 * The server sees only routing metadata (pairId, fromDeviceId).
 */
export interface RelayEnvelope {
  /** Server-assigned unique ID for this envelope (nanoid) */
  id: string;
  pairId: PairId;
  fromDeviceId: DeviceId;

  /** base64-encoded AES-GCM nonce (12 bytes) */
  nonce: string;

  /**
   * base64-encoded AES-GCM ciphertext of RelayPayload.
   * The server cannot decrypt this.
   */
  ciphertext: string;

  /** base64-encoded AES-GCM authentication tag (16 bytes) */
  authTag: string;

  /** Server-enforced limit: 64KB per envelope */
  size: number;

  createdAt: number;
  /** TTL: 30 days from createdAt */
  expiresAt: number;
}

/**
 * The decrypted content of a RelayEnvelope.
 * The server NEVER sees this — it exists only in the client's memory
 * after decryption.
 */
export interface RelayPayload {
  type: "INDEX_DELTA";
  fromDeviceId: DeviceId;

  /**
   * Only the BDPFileEntry records that changed since the last relay push.
   * NOT the full index — just the delta.
   */
  deltaEntries: BDPFileEntry[];

  merkleDelta: {
    /** Which Merkle node paths were affected by this delta */
    affectedPaths: string[];
    /** The new Merkle root after applying this delta */
    newRoot: SHA256Hex;
  };

  /** The sender's maxSeq when they last communicated with the recipient */
  fromSeq: number;

  /** The sender's maxSeq now (after these changes) */
  toSeq: number;

  pushedAt: number;
}

/**
 * State persisted in IndexedDB to track relay push/pull progress.
 * Stored under the 'relayState' object store, keyed by pairId.
 */
export interface RelayState {
  pairId: PairId;

  /** The last seq we successfully pushed to the relay */
  lastPushSeq: number;

  /** Unix ms — last time we fetched from the relay */
  lastFetchedAt: number;

  /**
   * true = we have local changes that haven't been pushed to the relay yet.
   * The Service Worker Background Sync job uses this flag.
   */
  pendingPush: boolean;

  /** Deduplication: set of relay envelope IDs we've already applied */
  appliedEnvelopeIds: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// § 9. Engine State Machine
// ─────────────────────────────────────────────────────────────────────────────

export type BDPEnginePhase =
  /** No peer connected, no sync in progress */
  | "idle"

  /** WebRTC connected, exchanging BDP_HELLO frames */
  | "greeting"

  /**
   * Walking the Merkle trees to find exactly which entries diverge.
   * Fast path: if root hashes match, skip directly to 'idle'.
   */
  | "diffing"

  /**
   * Requesting the remote's index entries for the diverged subtrees.
   * Used when we have shared history (sinceSeq > 0).
   */
  | "delta_sync"

  /**
   * Requesting the remote's full index (sinceSeq = 0).
   * Used on first sync or after an index reset.
   */
  | "full_sync"

  /**
   * Uploading and downloading files in parallel (max 3 concurrent).
   * Each file goes through: BDP_CHUNK_REQUEST → BDP_CHUNK × N → BDP_ACK.
   */
  | "transferring"

  /**
   * One or more conflicts detected.
   * Sync is paused until all conflicts are resolved.
   */
  | "resolving_conflict"

  /**
   * All transfers complete.
   * Updating Merkle index, pushing delta to relay, persisting state.
   */
  | "finalizing"

  /** A recoverable error occurred — retrying (up to 3× with backoff) */
  | "retrying"

  /** A fatal error occurred — user action required */
  | "error";

export interface BDPEngineState {
  phase: BDPEnginePhase;
  pairId: PairId | null;
  peerDeviceId: DeviceId | null;
  peerDeviceName: string | null;

  /** Current sync plan (populated after diffing/sync phase) */
  syncPlan: BDPSyncPlan | null;

  /** In-flight transfers, keyed by transferId */
  activeTransfers: Record<TransferId, BDPTransferState>;

  /** Unresolved conflicts requiring user action */
  pendingConflicts: BDPConflict[];

  /** Running stats for the current session */
  sessionStats: BDPSyncStats;

  /** Error details when phase === 'error' | 'retrying' */
  error: BDPError | null;

  /** Number of retry attempts for current operation */
  retryCount: number;
}

export interface BDPTransferState {
  transferId: TransferId;
  path: string;
  direction: "upload" | "download";
  totalChunks: number;
  completedChunks: number;
  totalBytes: number;
  transferredBytes: number;
  /** bytes/second, rolling average over last 3 seconds */
  speed: number;
  /** estimated seconds to completion */
  eta: number;
  startedAt: number;
}

export interface BDPSyncStats {
  filesUploaded: number;
  filesDownloaded: number;
  /** Files with identical hashes — skipped with no transfer */
  filesSkipped: number;
  filesConflicted: number;
  bytesUploaded: number;
  bytesDownloaded: number;
  /** Bytes NOT transferred because receiver already had the chunks in CAS */
  bytesSavedDedup: number;
  /** Bytes NOT transferred because of chunk compression */
  bytesSavedCompression: number;
  /** Chunks served from local CAS (no re-download needed) */
  chunksFromCAS: number;
  durationMs: number;
}

export interface BDPError {
  code: BDPErrorCode;
  message: string;
  recoverable: boolean;
  occurredAt: number;
  context?: Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────────────────────
// § 10. Sync History
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A conflict record stored in IndexedDB under 'conflicts', keyed by [pairId, path].
 * Created when two concurrent edits cannot be automatically resolved.
 */
export interface ConflictRecord {
  pairId: PairId;
  path: string;
  local: BDPFileEntry;
  remote: BDPFileEntry;

  /**
   * The auto-resolution computed from the pair's conflictStrategy.
   * 'none' = manual resolution required.
   */
  autoResolution: ConflictResolution | "none";

  /** When this conflict was first detected */
  detectedAt: number;

  /** When this conflict was resolved (null = still pending) */
  resolvedAt: number | null;

  /** Which resolution was actually applied (null = not yet resolved) */
  appliedResolution: ConflictResolution | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// § 10. Sync History
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A record of a completed sync session.
 * Stored in IndexedDB under 'syncHistory', keyed by [pairId, timestamp].
 */
export interface BDPSyncHistoryEntry {
  pairId: PairId;
  timestamp: number;
  peerDeviceId: DeviceId;
  peerDeviceName: string;
  stats: BDPSyncStats;
  syncType: "full" | "delta" | "no_change";
  newMerkleRoot: SHA256Hex;
}

// ─────────────────────────────────────────────────────────────────────────────
// § 11. OPFS Vault
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A file entry as seen through the VaultBrowser UI.
 * Derived from BDPFileEntry + OPFS metadata.
 */
export interface VaultFileInfo {
  path: string;
  name: string;
  size: number;
  mtime: number;
  /** MIME type inferred from extension */
  mimeType: string;
  /** Whether this file has a preview available in the app */
  previewable: boolean;
  /** Whether the file data is fully present in the CAS (ready to read) */
  available: boolean;
  /** true if this file has a pending conflict */
  conflicted: boolean;
}

/**
 * Result of a vault export operation.
 */
export interface VaultExportResult {
  pairId: PairId;
  exportedFiles: number;
  totalBytes: number;
  method: "fsapi" | "zip_download" | "individual_downloads";
  completedAt: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// § 12. Relay Server API (request/response shapes)
// ─────────────────────────────────────────────────────────────────────────────

export interface RelayPushRequest {
  pairId: PairId;
  fromDeviceId: DeviceId;
  nonce: string;
  ciphertext: string;
  authTag: string;
}

export interface RelayPushResponse {
  id: string;
  expiresAt: number;
}

export interface RelayPullRequest {
  pairId: PairId;
  deviceId: DeviceId;
  /** Return envelopes created after this Unix ms timestamp */
  since: number;
}

export interface RelayPullResponse {
  envelopes: RelayEnvelope[];
  /** Server's current time — used to calibrate 'since' for next pull */
  serverTime: number;
}

export interface RelayClearRequest {
  pairId: PairId;
  /** Delete envelopes created before this timestamp */
  upTo: number;
}

export interface RelayClearResponse {
  deleted: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// § 13. Type Guards
// ─────────────────────────────────────────────────────────────────────────────

export function isBDPFrame(value: unknown): value is BDPFrame {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<string, unknown>)["cp"] === true &&
    (value as Record<string, unknown>)["v"] === 1 &&
    typeof (value as Record<string, unknown>)["type"] === "string"
  );
}

export function isBDPHelloFrame(frame: BDPFrame): frame is BDPHelloFrame {
  return frame.type === "BDP_HELLO";
}

export function isBDPChunkFrame(frame: BDPFrame): frame is BDPChunkFrame {
  return frame.type === "BDP_CHUNK";
}

export function isBDPConflictFrame(frame: BDPFrame): frame is BDPConflictFrame {
  return frame.type === "BDP_CONFLICT";
}

export function isBDPErrorFrame(frame: BDPFrame): frame is BDPErrorFrame {
  return frame.type === "BDP_ERROR";
}

export function isBDPDoneFrame(frame: BDPFrame): frame is BDPDoneFrame {
  return frame.type === "BDP_DONE";
}

// ─────────────────────────────────────────────────────────────────────────────
// § 14. Vector Clock Utilities (pure functions, no side effects)
// ─────────────────────────────────────────────────────────────────────────────

export type ClockComparison = "a_wins" | "b_wins" | "concurrent" | "identical";

/**
 * Compare two vector clocks.
 *
 * a_wins:    every component of a >= b, and at least one a[k] > b[k]
 * b_wins:    every component of b >= a, and at least one b[k] > a[k]
 * identical: a === b component-wise
 * concurrent: neither dominates the other → conflict
 */
export function compareVectorClocks(
  a: VectorClock,
  b: VectorClock,
): ClockComparison {
  const allKeys = new Set([
    ...Object.keys(a),
    ...Object.keys(b),
  ]) as Set<DeviceId>;

  let aHasGreater = false;
  let bHasGreater = false;

  for (const key of allKeys) {
    const av = a[key] ?? 0;
    const bv = b[key] ?? 0;
    if (av > bv) aHasGreater = true;
    if (bv > av) bHasGreater = true;
  }

  if (!aHasGreater && !bHasGreater) return "identical";
  if (aHasGreater && !bHasGreater) return "a_wins";
  if (bHasGreater && !aHasGreater) return "b_wins";
  return "concurrent";
}

/**
 * Merge two vector clocks by taking the component-wise maximum.
 * This is the standard CRDT merge for LWW registers.
 */
export function mergeVectorClocks(a: VectorClock, b: VectorClock): VectorClock {
  const result: Record<DeviceId, number> = { ...a };
  for (const [key, value] of Object.entries(b) as [DeviceId, number][]) {
    result[key] = Math.max(result[key] ?? 0, value);
  }
  return result as VectorClock;
}

/**
 * Increment a device's component in a vector clock.
 * Returns a new clock — does not mutate the input.
 */
export function incrementVectorClock(
  clock: VectorClock,
  deviceId: DeviceId,
): VectorClock {
  return {
    ...clock,
    [deviceId]: (clock[deviceId] ?? 0) + 1,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// § 15. Constants
// ─────────────────────────────────────────────────────────────────────────────

export const BDP_CONSTANTS = {
  /** Protocol version — increment when wire format changes */
  VERSION: 1 as const,

  /** Default chunk size: 256KB */
  CHUNK_SIZE: 262_144,

  /** Max concurrent transfers per session (upload + download combined) */
  MAX_CONCURRENT_TRANSFERS: 3,

  /** Max relay envelope size: 64KB */
  RELAY_MAX_ENVELOPE_SIZE: 65_536,

  /** Max envelopes stored per pairId on the relay */
  RELAY_MAX_ENVELOPES_PER_PAIR: 100,

  /** Relay envelope TTL: 30 days in ms */
  RELAY_TTL_MS: 30 * 24 * 60 * 60 * 1000,

  /** Minimum compression saving to justify compression overhead (10%) */
  COMPRESSION_THRESHOLD: 0.9,

  /** Ping interval when idle: 90 seconds */
  PING_INTERVAL_MS: 90_000,

  /** Transfer timeout: 30 seconds per chunk */
  CHUNK_TIMEOUT_MS: 30_000,

  /** Max retry attempts before entering fatal error state */
  MAX_RETRIES: 3,

  /** Exponential backoff base: 2 seconds */
  RETRY_BASE_DELAY_MS: 2_000,

  /** OPFS root path for all Chrysalis data */
  OPFS_ROOT: "bdp",

  /** OPFS sub-path for the CAS */
  OPFS_CAS: "bdp/cas",

  /** OPFS sub-path for the vault */
  OPFS_VAULT: "bdp/vault",

  /** OPFS sub-path for in-progress transfers */
  OPFS_TEMP: "bdp/temp",

  /** IndexedDB database name */
  IDB_DB_NAME: "bdp-v1",

  /** IndexedDB version */
  IDB_DB_VERSION: 1,

  /** HKDF info string for group key derivation */
  HKDF_INFO: "bdp-group-key-v1",

  /** AES-GCM nonce length in bytes */
  AES_NONCE_BYTES: 12,

  /** AES-GCM key length in bits */
  AES_KEY_BITS: 256,

  /** File types that are already compressed — skip CompressionStream */
  ALREADY_COMPRESSED_EXTENSIONS: new Set([
    "jpg",
    "jpeg",
    "png",
    "gif",
    "webp",
    "avif",
    "heic",
    "mp4",
    "webm",
    "mov",
    "mkv",
    "avi",
    "mp3",
    "aac",
    "ogg",
    "opus",
    "flac",
    "zip",
    "gz",
    "bz2",
    "xz",
    "zst",
    "7z",
    "rar",
    "pdf",
    "docx",
    "xlsx",
    "pptx",
    "wasm",
  ]),
} as const;
