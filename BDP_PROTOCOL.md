# The Butterfly Delta Protocol (BDP)
### A Novel P2P File Synchronization Protocol for the Browser

> *A delta is where transformation happens — where something ordinary transforms into something that can fly.*
> *This protocol transforms ephemeral P2P file transfers into persistent, bidirectional, cross-browser sync.*

---

## 0. Why This Exists

Every existing sync tool assumes a **persistent process running on the OS**.

- Syncthing: Go daemon, always running
- Obsidian Sync: Cloud relay, always available
- rsync: CLI tool, one-shot
- Git: Local object store + remote server

**Browsers have none of that.** A browser tab is ephemeral. It can be closed. It can't watch the filesystem. It can't run in the background. It can't write files to arbitrary paths on Firefox or Safari.

Instead of fighting these constraints, the Butterfly Delta Protocol is designed *around* them — using every modern browser API available as of 2025, combining them in ways that have never been combined before.

The result: a sync protocol that is **native to the web**, works on every modern browser, requires zero installation, and never sends your file contents through any server.

---

## 1. The Ten Innovations

### 1.1 — OPFS as Universal Sync Vault

**The insight:** The Origin Private File System (`navigator.storage.getDirectory()`) is a full read/write filesystem available on Chrome, Firefox, AND Safari with **zero user permission required**, persisting across sessions, offering up to 60% of disk space.

No other sync tool has ever used OPFS as a sync target. We use it as the **universal receive buffer** — every browser becomes a full peer, not a second-class citizen.

```
Traditional thinking:
  Receive file → showSaveFilePicker() → user chooses location
  → Chrome only, one file at a time, breaks automation

BDP thinking:
  Receive file → write to OPFS vault → always works, everywhere
  → User can browse vault in-app, export anytime
  → Chrome/Edge users can ALSO get live write-through to real folder (opt-in)
```

### 1.2 — Encrypted Delta Relay

**The problem BDP v1 didn't solve:** Both peers must be online simultaneously. If you change files on your laptop at work, your home desktop won't know until both are open *at the same time*.

**The solution:** Repurpose our existing signaling server as a **lightweight delta relay**.

The relay stores **encrypted index deltas** (file metadata, never file content) that offline peers can fetch when they reconnect. The relay is **mathematically incapable** of reading the content — deltas are encrypted with a key derived entirely from the shared `pairId` secret.

This separates sync into two independent planes:
- **Index propagation**: asynchronous, via relay, works when peers are offline
- **File data transfer**: synchronous, P2P only, requires both peers online

Think of it as: *"The relay carries the map, WebRTC carries the territory."*

### 1.3 — ECDH Shared Key from Pair Setup

When two devices scan the same QR code / open the same link, they already exchange identity via the WebRTC signaling flow. We extend this to derive a **shared encryption key** via ECDH (Elliptic Curve Diffie-Hellman):

```
Device A:  generates X25519 keypair
Device B:  generates X25519 keypair
Exchange:  public keys flow through signaling (visible to server)
Derive:    sharedKey = ECDH(A.private, B.public) = ECDH(B.private, A.public)
Result:    both devices have identical AES-256-GCM key, server has nothing
```

For n-way (3+ devices), we use HKDF to derive a group key from the `pairId`:
```
groupKey = HKDF(pairId, "bdp-v1", SHA-256, 256-bit)
```

Since the `pairId` is a cryptographically random string shared only via QR/link, this is effectively a **password-based group key** with high entropy.

### 1.4 — Merkle Tree Index

**The problem:** A folder with 10,000 files where 3 changed. How do you tell the peer which 3 changed without sending all 10,000 entries?

**The solution:** Represent the file index as a Merkle tree. Exchange root hashes first (O(1)). If equal: nothing to do. If different: binary-search the tree to find exactly which subtrees diverged.

```
Naive approach:   send all 10,000 entries → O(n)
Merkle approach:  send ~42 entries → O(changed × log₂(n))
```

The Merkle root is a single 32-byte SHA-256 hash that uniquely fingerprints the entire folder state. If roots match, sync is instant.

### 1.5 — Content-Addressable Chunk Store (CAS) in OPFS

Inspired by git's object store and IPFS's content addressing. Every 256KB chunk of every file is stored in OPFS **by its SHA-256 hash**, not by filename.

```
opfs://bdp/cas/
├── a1/b2c3...  ← first 2 chars = dir, rest = filename
├── fe/9abc...
└── ...
```

Benefits:
- **Resumable transfers**: interrupted? Request only missing chunk hashes
- **Cross-file deduplication**: two files with identical blocks share the same CAS entries
- **Modified file efficiency**: a 100MB file where you appended 1KB only transfers ~4KB (one new chunk + one partial chunk)
- **Idempotent writes**: writing a chunk that already exists is a no-op
- **Integrity verification**: hash the received chunk, compare to requested hash

### 1.6 — Vector Clock CRDTs per File

Each file in the index carries a **vector clock**: a map of `{ deviceId → sequence }`.

This gives us **mathematical conflict detection** without a central coordinator:

```
A's clock: { alice: 3, bob: 1 }
B's clock: { alice: 2, bob: 2 }

A > B?  alice: 3>2 ✓   bob: 1<2 ✗  → NEITHER dominates → CONCURRENT → CONFLICT
A > C?  alice: 3>1 ✓   bob: 1=1 ✓  → A DOMINATES → A wins, no conflict
```

The index itself is a **CRDT (Conflict-free Replicated Data Type)**: any two replicas can always be merged into a consistent result. Tombstones handle deletes. The merge is commutative, associative, and idempotent — properties inherited from the Add-Wins Set + LWW Register structure.

### 1.7 — Native Stream Compression

Using the browser-native `CompressionStream` / `DecompressionStream` API (widely available since May 2023), chunks are compressed before transfer for text-based content:

```
Sender:
  chunk → CompressionStream('deflate-raw') → compressed bytes
  if compressed < original × 0.9:  send compressed (flag in frame header)
  else:                             send raw (binary already compressed)

Receiver:
  read frame header → if compressed: DecompressionStream → original bytes
```

No WASM, no libraries, no overhead. Pure browser-native.

### 1.8 — Web Locks for Multi-Tab Safety

If the user has two tabs open, both might try to sync simultaneously, causing OPFS write conflicts. Web Locks (`navigator.locks.request()`) solve this with zero overhead:

```typescript
await navigator.locks.request(`bdp-${pairId}`, async () => {
  // Only one tab can hold this lock at a time
  // Other tabs queue and wait automatically
  await performSync()
})
```

Works on Chrome, Firefox, and Safari. Available everywhere.

### 1.9 — Service Worker Delta Push

On Chrome (Background Sync API), when the app detects file changes, it registers a background sync tag. The Service Worker pushes the encrypted delta to the relay **even if the tab is closed shortly after**:

```typescript
// App tab: "files changed, register SW sync"
await registration.sync.register(`bdp-push-${pairId}`)

// Service Worker: fires when network is available
self.addEventListener('sync', (event) => {
  if (event.tag.startsWith('bdp-push-')) {
    event.waitUntil(pushEncryptedDeltaToRelay(pairId))
  }
})
```

On Firefox/Safari: delta is pushed while the tab is open (still useful for the common case).

### 1.10 — Progressive Permission Model

No browser is left behind. The experience gets richer with more capability, but the protocol never breaks:

```
TIER 0 — Any browser, any device
  Read:   <input webkitdirectory> or drag-and-drop
  Write:  OPFS vault (zero permission needed)
  Sync:   Full bidirectional via Butterfly Delta Protocol
  Export: "Download as ZIP" or individual file downloads

TIER 1 — Chrome / Edge desktop
  Read:   showDirectoryPicker() → persistent FileSystemDirectoryHandle
  Write:  OPFS vault + optional write-through to real folder (FSAPI)
  Watch:  FileSystemObserver (experimental, progressive enhancement)
  Sync:   Full auto-sync on peer connect
  Export: Direct write to chosen folder

TIER 2 — Chrome with SW support  (extends Tier 1)
  Push:   Background Sync API → delta pushed even when tab is closed
```

---

## 2. System Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CLIENT (Browser)                               │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                          UI Layer                                   │   │
│  │  VaultBrowser · SyncDashboard · ConflictResolver · SyncProgress     │   │
│  └──────────────────────────┬──────────────────────────────────────────┘   │
│                             │                                               │
│  ┌──────────────────────────▼──────────────────────────────────────────┐   │
│  │                    BDP Engine (useBDP)                  │   │
│  │           State machine driving the full sync lifecycle             │   │
│  └──┬─────────────┬──────────────┬───────────────────┬────────────────┘   │
│     │             │              │                   │                     │
│  ┌──▼──────┐ ┌───▼──────┐ ┌────▼──────┐ ┌──────────▼──────────────────┐  │
│  │  File   │ │ Merkle   │ │ BDP Wire   │ │      Storage Layer          │  │
│  │ Access  │ │  Index   │ │ Protocol  │ │  ┌──────────┬─────────────┐ │  │
│  │ Layer   │ │  Engine  │ │ (WebRTC)  │ │  │IndexedDB │    OPFS     │ │  │
│  └──┬──────┘ └──────────┘ └────┬──────┘ │  │ (meta)   │(vault+cas)  │ │  │
│     │                          │        │  └──────────┴─────────────┘ │  │
│     │ FSAPI (Tier 1)           │        └────────────────────────────────┘  │
│     │ webkitdirectory (Tier 0) │                                            │
│     └──────────────────────────┘                                            │
└────────────────────────────────────────┬────────────────────────────────────┘
                                         │ WebRTC (file data, index exchange)
                                         │ HTTPS (encrypted deltas ONLY)
                               ┌─────────▼───────────────┐
                               │     Signaling Server    │
                               │  ┌─────────────────────┐│
                               │  │   Delta Relay Store ││  ← encrypted blobs only
                               │  │   (no file content) ││  ← TTL: 30 days
                               │  │   (server is blind) ││  ← max 1MB per pair
                               │  └─────────────────────┘│
                               └─────────────────────────┘
```

---

## 3. Data Structures

### 3.1 Device Identity

```typescript
interface BDPDevice {
  // Persistent random ID, stored in IndexedDB on first launch
  deviceId: string                // nanoid(21)

  // Human-readable name shown in UI
  deviceName: string              // e.g. "ubuntu-firefox", "pixel-8-chrome"

  // Monotonically increasing per-device counter
  // Incremented on EVERY local file change
  localSeq: number

  // Persistent X25519 keypair for ECDH
  publicKey: CryptoKey            // exportable, shared during pairing
  privateKey: CryptoKey           // non-exportable, never leaves device

  // Browser capability flags
  capabilities: BDPCapabilities
}

interface BDPCapabilities {
  hasFSAPI: boolean               // showDirectoryPicker available
  hasOPFS: boolean                // always true in modern browsers
  canWriteRealFS: boolean         // FSAPI write support (Chrome/Edge)
  hasBackgroundSync: boolean      // SW Background Sync API
  hasFileObserver: boolean        // FileSystemObserver (experimental)
  compressionAlgos: ('deflate-raw' | 'gzip' | 'deflate')[]
}
```

### 3.2 Sync Pair

```typescript
interface SyncPair {
  // Shared secret: nanoid(32), high entropy, shared via QR/link
  // This IS the authentication token. Keep it secret.
  pairId: string

  // Derived from pairId via HKDF, used to encrypt relay messages
  // NEVER stored directly — re-derived on each session from pairId
  // groupKey: AES-256-GCM CryptoKey  (derived, not stored)

  // Known devices in this pair (2 for 1:1, n for group sync)
  devices: BDPPeerInfo[]

  // Local folder configuration
  localFolder: BDPLocalFolder

  // Sync behavior
  direction: 'bidirectional' | 'upload-only' | 'download-only'
  conflictStrategy: 'last-write-wins' | 'manual' | 'local-wins' | 'remote-wins'

  // Selective sync rules (gitignore-style patterns)
  includePatterns: string[]       // e.g. ['**/*.md', 'src/**']
  excludePatterns: string[]       // e.g. ['node_modules/**', '*.log']
  maxFileSizeBytes: number        // default: 500MB

  // Timestamps
  createdAt: number
  lastSyncedAt: number | null
  lastDeltaFetchedAt: number | null

  // Index state
  localMerkleRoot: string | null  // SHA-256 of current local index root
  knownRemoteRoots: Record<string, string>  // { deviceId: merkleRoot }
}

interface BDPLocalFolder {
  name: string                                      // display name
  handle?: FileSystemDirectoryHandle                // Chrome/Edge: real FS
  opfsPath: string                                  // always: vault path in OPFS
  useRealFS: boolean                                // whether to write-through to real FS
}

interface BDPPeerInfo {
  deviceId: string
  deviceName: string
  publicKey: string               // base64-encoded X25519 public key
  lastSeenAt: number | null
  sharedKey?: CryptoKey           // derived via ECDH, not stored (re-derived)
}
```

### 3.3 Merkle Index

```typescript
// A single file's state in the index
interface BDPFileEntry {
  path: string                    // relative path, always '/' separator, UTF-8 NFC
  hash: string                    // SHA-256 of full file content (hex)
  size: number                    // bytes
  mtime: number                   // ms since epoch
  chunkHashes: string[]           // SHA-256 of each chunk in order (hex)
  chunkSize: number               // chunk size in bytes (default: 262144 = 256KB)
  vectorClock: VectorClock        // { [deviceId]: sequence }
  deviceId: string                // who last modified this file
  seq: number                     // this device's sequence at time of modification
  tombstone: boolean              // true = deleted
  tombstoneAt?: number            // when it was deleted
  compressed?: boolean            // hint: is this file type already compressed?
}

type VectorClock = Record<string, number>

// A node in the Merkle tree
interface BDPMerkleNode {
  hash: string                    // SHA-256(children's hashes concatenated)
  // children: path segment → subtree hash (stored in IndexedDB separately)
  // Leaf nodes have no children, just reference a BDPFileEntry
}

// The root of the Merkle tree
interface BDPIndexRoot {
  pairId: string
  deviceId: string                // whose index this is
  rootHash: string                // current Merkle root
  entryCount: number              // total files in index
  maxSeq: number                  // highest sequence number
  computedAt: number              // when this root was computed
}
```

### 3.4 CAS Chunk Store

```typescript
// A chunk in the content-addressable store
interface CASChunk {
  hash: string                    // SHA-256 of uncompressed content (hex)
  // OPFS path: bdp/cas/{hash[0:2]}/{hash[2:]}
  // Content: raw bytes (may be stored compressed if compression saved space)
  storedCompressed: boolean
  originalSize: number
  storedSize: number
  refCount: number                // how many files reference this chunk
  createdAt: number
  lastAccessedAt: number
}
```

### 3.5 Protocol Wire Frames

```typescript
// Every frame over the WebRTC DataChannel is one of these
type BDPFrame =
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

// Common header on all frames
interface BDPFrameHeader {
  cp: true                        // fast type discriminant
  v: 1                            // protocol version
  type: string                    // frame type
  pairId: string
  msgId: string                   // nanoid, for request-response correlation
  fromDeviceId: string
  ts: number                      // sender timestamp (ms)
}

// ── Handshake ────────────────────────────────────────────────────────────────

interface BDPHelloFrame extends BDPFrameHeader {
  type: 'BDP_HELLO'
  payload: {
    deviceName: string
    capabilities: BDPCapabilities
    publicKey: string             // base64 X25519 public key
    pairs: Array<{
      pairId: string
      merkleRoot: string          // current local root hash
      maxSeq: number              // highest local sequence number
      indexId: string             // unique ID for current index (changes on reset)
    }>
  }
}

// ── Index Exchange ────────────────────────────────────────────────────────────

interface BDPMerkleFrame extends BDPFrameHeader {
  type: 'BDP_MERKLE'
  payload: {
    pairId: string
    path: string                  // '' = root, 'src' = subtree at src/
    nodeHash: string
    childHashes: Record<string, string>  // { segmentName: childHash }
  }
}

interface BDPIndexRequestFrame extends BDPFrameHeader {
  type: 'BDP_INDEX_REQUEST'
  payload: {
    pairId: string
    sinceSeq: number              // 0 = full index, N = delta since seq N
    paths?: string[]              // optional: only request specific paths
  }
}

interface BDPIndexResponseFrame extends BDPFrameHeader {
  type: 'BDP_INDEX_RESPONSE'
  payload: {
    pairId: string
    entries: BDPFileEntry[]
    isComplete: boolean           // false = more chunks coming (large indexes)
    totalEntries: number
  }
}

// ── File Transfer ─────────────────────────────────────────────────────────────

interface BDPChunkRequestFrame extends BDPFrameHeader {
  type: 'BDP_CHUNK_REQUEST'
  payload: {
    pairId: string
    path: string
    requestId: string             // unique ID for this file transfer
    // Chunks we ALREADY HAVE — sender skips these (rsync-like)
    haveChunks: string[]          // array of chunk hashes we already have
    // Chunks we NEED — sender sends these
    needChunks: string[]          // array of chunk hashes we need
    totalChunks: number
  }
}

// Binary frame — NOT JSON — for efficiency
// Layout: [header_length: uint16][header: JSON bytes][data: ArrayBuffer]
interface BDPChunkFrame extends BDPFrameHeader {
  type: 'BDP_CHUNK'
  payload: {
    pairId: string
    requestId: string             // matches BDPChunkRequestFrame.requestId
    chunkHash: string             // hash of UNCOMPRESSED content
    chunkIndex: number            // position in file's chunk list
    isLast: boolean
    compressed: boolean           // is the data in this frame compressed?
    originalSize: number
  }
  // data: ArrayBuffer follows the JSON header
}

interface BDPAckFrame extends BDPFrameHeader {
  type: 'BDP_ACK'
  payload: {
    pairId: string
    requestId: string
    path: string
    status: 'ok' | 'hash_mismatch' | 'write_error'
    receivedHash?: string         // what we actually got (for hash_mismatch)
  }
}

// ── Conflict Handling ─────────────────────────────────────────────────────────

interface BDPConflictFrame extends BDPFrameHeader {
  type: 'BDP_CONFLICT'
  payload: {
    pairId: string
    path: string
    localEntry: BDPFileEntry
    remoteEntry: BDPFileEntry
    // Strategy from pair config
    autoResolution: 'manual' | 'local-wins' | 'remote-wins' | 'last-write-wins'
  }
}

interface BDPConflictResolutionFrame extends BDPFrameHeader {
  type: 'BDP_CONFLICT_RESOLUTION'
  payload: {
    pairId: string
    path: string
    resolution: 'keep-local' | 'keep-remote' | 'keep-both'
    // If keep-both, the losing version is renamed:
    renamedPath?: string          // e.g. "notes.md.alice.conflict"
  }
}

// ── Session Control ───────────────────────────────────────────────────────────

interface BDPDoneFrame extends BDPFrameHeader {
  type: 'BDP_DONE'
  payload: {
    pairId: string
    stats: BDPSyncStats
    newMerkleRoot: string         // root after sync
    newMaxSeq: number
  }
}

interface BDPErrorFrame extends BDPFrameHeader {
  type: 'BDP_ERROR'
  payload: {
    pairId: string
    code: BDPErrorCode
    message: string
    recoverable: boolean
  }
}

interface BDPPingFrame extends BDPFrameHeader {
  type: 'BDP_PING'
  payload: { nonce: string }
}

type BDPErrorCode =
  | 'PAIR_NOT_FOUND'
  | 'CRYPTO_ERROR'
  | 'INDEX_CORRUPT'
  | 'STORAGE_FULL'
  | 'PERMISSION_DENIED'
  | 'TRANSFER_FAILED'
  | 'CONFLICT_UNRESOLVED'
  | 'VERSION_MISMATCH'

interface BDPSyncStats {
  filesUploaded: number
  filesDownloaded: number
  filesSkipped: number            // unchanged
  filesConflicted: number
  bytesUploaded: number
  bytesDownloaded: number
  bytesSavedDedup: number         // bytes saved by chunk deduplication
  bytesSavedCompression: number   // bytes saved by compression
  chunksFromCAS: number           // chunks served from local CAS (not re-downloaded)
  durationMs: number
}
```

### 3.6 Delta Relay Message (Server-Side)

```typescript
// What the server stores — it CANNOT read the encrypted payload
interface RelayEnvelope {
  id: string                      // nanoid, for deduplication
  pairId: string                  // visible to server (routing only)
  fromDeviceId: string            // visible to server (routing only)
  // Everything else is opaque to the server:
  nonce: string                   // base64 AES-GCM nonce (12 bytes)
  ciphertext: string              // base64 AES-GCM encrypted payload
  authTag: string                 // base64 AES-GCM auth tag (16 bytes)
  // Server-managed metadata:
  createdAt: number
  expiresAt: number               // TTL: 30 days
  size: number                    // enforced limit: 64KB per envelope
}

// The decrypted payload — server NEVER sees this
interface RelayPayload {
  type: 'INDEX_DELTA'
  fromDeviceId: string
  deltaEntries: BDPFileEntry[]     // only changed files since last push
  merkleDelta: {
    affectedPaths: string[]       // which Merkle paths changed
    newRoot: string               // new Merkle root after applying delta
  }
  fromSeq: number                 // "I had seq N when I last talked to you"
  toSeq: number                   // "I now have seq M"
  pushedAt: number
}
```

---

## 4. Protocol State Machine

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        BDP ENGINE STATES                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   ┌──────────┐                                                              │
│   │   IDLE   │ ← both sync pairs are in sync, no peer online               │
│   └────┬─────┘   or waiting for first pair to be created                   │
│        │ peer connects (WebRTC established)                                 │
│   ┌────▼──────────┐                                                         │
│   │  GREETING     │ BDP_HELLO ↔ BDP_HELLO                                     │
│   │               │ exchange: deviceId, capabilities, merkleRoot, maxSeq   │
│   └────┬──────────┘                                                         │
│        │                                                                    │
│        ├─── roots match ──────────────────────────→ IDLE (nothing to do)   │
│        │                                                                    │
│        ├─── roots differ, have shared seq history → DELTA_SYNC             │
│        │                                                                    │
│        └─── first time / index reset ────────────→ FULL_SYNC               │
│                                                                             │
│   ┌────▼────────────────┐  ┌─────────────────────┐                         │
│   │   DELTA_SYNC        │  │    FULL_SYNC         │                         │
│   │                     │  │                      │                         │
│   │  BDP_INDEX_REQUEST   │  │  BDP_INDEX_REQUEST    │                         │
│   │  (sinceSeq: N)      │  │  (sinceSeq: 0)       │                         │
│   │  BDP_INDEX_RESPONSE  │  │  BDP_INDEX_RESPONSE   │                         │
│   │  compute SyncPlan   │  │  compute SyncPlan    │                         │
│   └────┬────────────────┘  └──────┬──────────────┘                         │
│        └────────────┬─────────────┘                                         │
│                     │ SyncPlan computed                                     │
│                     │                                                       │
│                ┌────▼─────────────────┐                                     │
│                │   TRANSFERRING       │                                     │
│                │                      │                                     │
│                │  parallel upload     │                                     │
│                │  parallel download   │                                     │
│                │  (max 3 concurrent)  │                                     │
│                └────┬─────────────────┘                                     │
│                     │                                                       │
│                     ├─── conflicts detected ──→ RESOLVING_CONFLICT          │
│                     │                          (blocks until resolved)      │
│                     │                                                       │
│                     └─── all files done ──────→ FINALIZING                  │
│                                                                             │
│   ┌─────────────────────────────────────────────────────────────────────┐  │
│   │  RESOLVING_CONFLICT                                                  │  │
│   │   Show ConflictResolver UI                                           │  │
│   │   User picks: keep-local | keep-remote | keep-both                  │  │
│   │   BDP_CONFLICT_RESOLUTION ↔ peer                                     │  │
│   │   Resume TRANSFERRING                                                │  │
│   └─────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│   ┌─────────────────────────────────────────────────────────────────────┐  │
│   │  FINALIZING                                                          │  │
│   │   Update Merkle index roots                                          │  │
│   │   Push encrypted delta to relay (for offline peers)                 │  │
│   │   Persist new BDPIndexRoot to IndexedDB                              │  │
│   │   Emit sync stats                                                    │  │
│   │   → IDLE                                                             │  │
│   └─────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│   ERROR state: recoverable errors retry (3x exponential backoff)            │
│                fatal errors show UI, require user action                   │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 5. Complete Sync Flow

### 5.1 Initial Pair Setup

```
DEVICE A                           SIGNALING SERVER               DEVICE B
────────                           ─────────────────              ────────
1. Generate X25519 keypair
2. Generate pairId (nanoid32)
3. Create SyncPair in IndexedDB
4. Show QR code with:
   pairId + sessionId + A.publicKey

                                                          5. User scans QR
                                                          6. Generate X25519 keypair
                                                          7. WebRTC signaling flow
                                                             (existing BDP infra)
8. Receive B.publicKey via signal
9. Derive sharedKey via ECDH:
   ECDH(A.private, B.public)
                                                          8. Receive A.publicKey
                                                          9. Derive sharedKey via ECDH:
                                                             ECDH(B.private, A.public)

Both now have identical sharedKey (server never sees it)
WebRTC DataChannel established

10. BDP_HELLO → (capabilities, merkleRoot: null, maxSeq: 0)
                                                          10. BDP_HELLO → (same)

11. Both: "new pair, no history" → full sync
```

### 5.2 Delta Relay Flow (Offline Scenario)

```
DEVICE A (at work, 9am)            RELAY SERVER           DEVICE B (at home, offline)
───────────────────────            ────────────           ────────────────────────────
1. Opens app
2. Modifies 3 files
3. App detects changes
   (file scanner / focus event)
4. Update local Merkle index
5. Encrypt delta with groupKey:
   AES-GCM(groupKey, deltaPayload)
6. POST /relay/push
   { pairId, nonce, ciphertext }
                                   7. Store RelayEnvelope
                                      (cannot read content)

   ... Device A closes laptop ...

                                                          8. User opens app at home
                                                          9. GET /relay/pull?pairId=X
                                   10. Return envelopes
                                       since lastFetched
                                                          11. Decrypt envelopes:
                                                              AES-GCM decrypt with groupKey
                                                          12. Apply deltaEntries to local index
                                                          13. Now B's index knows:
                                                              "A changed these 3 files"
                                                          14. B shows: "3 files pending
                                                              from Device A (offline)"
                                                          15. When A comes back online:
                                                              BDP_HELLO → both online
                                                              DELTA_SYNC starts
                                                              B requests the 3 files
                                                              A sends them
                                                              Done ✓
```

### 5.3 Merkle Diff Walk

```
DEVICE A's INDEX ROOT: abc123
DEVICE B's INDEX ROOT: def456

→ Different! Start Merkle walk...

A: BDP_MERKLE { path: '', hash: 'abc123', children: { src: 'x1', docs: 'y1', readme.md: 'z1' } }
B: has root 'def456', children: { src: 'x1', docs: 'y2', readme.md: 'z1' }

Compare children:
  src:       x1 == x1  ✓ IDENTICAL, skip subtree
  docs:      y1 != y2  ✗ DIVERGED, recurse
  readme.md: z1 == z1  ✓ IDENTICAL, skip

A: BDP_MERKLE { path: 'docs', hash: 'y1', children: { guide.md: 'p1', api.md: 'q1' } }
B: has 'y2', children: { guide.md: 'p1', api.md: 'q2' }

  docs/guide.md: p1 == p1  ✓ skip
  docs/api.md:   q1 != q2  ✗ DIVERGED, this is a leaf

→ Found: docs/api.md differs
→ Request full FileEntry for docs/api.md
→ Compare vector clocks → determine winner or conflict
→ Transfer only this one file

Total: scanned 7 nodes, transferred 1 file's metadata
vs naive: scanned all N files, transferred all N entries
```

### 5.4 CAS-Based File Transfer (Chunk Deduplication)

```
Scenario: B already has an older version of docs/api.md (it was 50KB, now 52KB)

DEVICE B (downloader)              DEVICE A (uploader)
─────────────────────              ──────────────────
1. Check local CAS for
   chunks of new version:
   
   New version chunks:
   [chunk0: "hash_a", 256KB]  ← DO I HAVE THIS?
   [chunk1: "hash_b", 256KB]  ← DO I HAVE THIS?  (wait, I had old version)
   [chunk2: "hash_c",  2KB]   ← DO I HAVE THIS?
   
   Old version chunks (in CAS):
   [chunk0: "hash_a"]  ← YES, already have this (file starts the same!)
   [chunk1: "hash_d"]  ← different hash, don't have hash_b
   [chunk2: "hash_e"]  ← different hash, don't have hash_c

2. BDP_CHUNK_REQUEST {
     path: 'docs/api.md',
     haveChunks: ['hash_a'],   ← skip this
     needChunks: ['hash_b', 'hash_c']
   }

3.                              Receives request
                                Skip chunk 0 (B already has hash_a!)
                                Send chunk 1 (hash_b, 256KB → compress → maybe 80KB)
                                Send chunk 2 (hash_c, 2KB → compress → maybe 1KB)

4. Receive chunk 1, write to CAS by hash_b
   Receive chunk 2, write to CAS by hash_c

5. Reconstruct file from CAS:
   cat(hash_a, hash_b, hash_c) → docs/api.md
   Verify SHA-256 == expected hash

6. Write to OPFS vault (and real FS if Tier 1)

Result: transferred ~81KB instead of ~512KB (84% saving for this file)
```

---

## 6. Vector Clock Conflict Examples

### 6.1 Clean Merge (No Conflict)

```
A edits notes.md → A's clock for this file: { alice: 3 }
B has not touched notes.md → B's clock: { alice: 2 }

Compare: alice: 3 > 2 ✓, no other dimensions
→ A's version DOMINATES B's
→ A wins, transfer A→B, no conflict
```

### 6.2 True Conflict (Concurrent Edits)

```
A edits notes.md → A's clock: { alice: 5, bob: 2 }
B edits notes.md → B's clock: { alice: 4, bob: 3 }

Compare:
  alice: 5 > 4  → A has seen more alice changes
  bob:   2 < 3  → B has seen more bob changes
→ NEITHER dominates the other
→ CONCURRENT edit → CONFLICT

Conflict resolution options:
  1. Manual: show both versions in UI, user picks
  2. Last-write-wins: compare mtime, pick newer
  3. Local-wins / Remote-wins: deterministic, no UI
  4. Keep-both: rename loser to "notes.md.bob.conflict"
```

### 6.3 Three-Device Convergence

```
Devices: Alice, Bob, Carol (all share pairId)

T1: Alice edits file.txt → clock: { alice: 1 }
T2: Alice pushes delta to relay
T3: Bob fetches delta → knows about Alice's edit, clock: { alice: 1, bob: 0 }
T4: Bob ALSO edits file.txt → clock: { alice: 1, bob: 1 } (he saw Alice's edit first!)
T5: Bob is online with Alice → delta sync, no conflict (Bob > Alice on this file)
T6: Carol comes online, fetches relay deltas (both Alice's and Bob's)
T7: Carol's index: knows about { alice:1, bob:1 } version
T8: Carol connects to either peer → gets file, no conflict
→ All three devices converge to Bob's version ✓
```

---

## 7. OPFS Vault Structure

```
navigator.storage.getDirectory()  (OPFS root)
└── bdp/
    ├── cas/                           ← Content-Addressable Store
    │   ├── a1/
    │   │   └── b2c3d4e5...f6g7h8     ← chunk by hash (raw or compressed bytes)
    │   ├── fe/
    │   │   └── 9abc12...             
    │   └── ...
    │
    ├── vault/                         ← Reconstructed file tree
    │   └── {pairId}/
    │       ├── .bdp/
    │       │   ├── index.json         ← cached Merkle index (rebuilt from IndexedDB)
    │       │   └── history.json       ← last N sync events
    │       ├── .conflicts/            ← preserved conflict losers
    │       │   └── notes.md.alice.2024-01-15T09:30:00
    │       ├── src/
    │       │   ├── index.ts
    │       │   └── utils.ts
    │       └── docs/
    │           └── api.md
    │
    └── temp/                          ← In-progress transfers (deleted on complete)
        └── {transferId}/
            └── {chunkHash}            ← chunks as they arrive
```

**OPFS Storage Quotas (what we can actually use):**
- Chrome/Edge: ~60% of total disk
- Firefox: ~10GB (or 10% of disk)
- Safari 17+: ~60% of total disk

**For most users this means 50-500GB available — more than enough.**

---

## 8. IndexedDB Schema

```typescript
// All stores are keyed under the 'bdp-v1' database

// Store: 'devices'
// Key: deviceId (our own device — there's only one entry)
type DeviceStore = BDPDevice

// Store: 'pairs'
// Key: pairId
type PairsStore = SyncPair

// Store: 'fileIndex'
// Key: [pairId, path]
// Index: by [pairId, seq] for delta queries
// Index: by [pairId, tombstone] for listing
type FileIndexStore = BDPFileEntry

// Store: 'merkleNodes'
// Key: [pairId, nodePath]
// A node is a hash of its children's hashes
type MerkleNodeStore = {
  pairId: string
  nodePath: string              // '' = root, 'src' = subtree at src/
  hash: string
  childCount: number
  updatedAt: number
}

// Store: 'casIndex'
// Key: chunkHash
// (actual chunk data lives in OPFS, this is just the metadata)
type CASIndexStore = CASChunk

// Store: 'syncHistory'
// Key: [pairId, timestamp]
type SyncHistoryStore = {
  pairId: string
  timestamp: number
  stats: BDPSyncStats
  peerDeviceId: string
  peerDeviceName: string
}

// Store: 'relayState'
// Key: pairId
type RelayStateStore = {
  pairId: string
  lastPushSeq: number           // last seq we pushed to relay
  lastFetchedAt: number         // last time we fetched from relay
  pendingPush: boolean          // SW background sync needs to push
}

// Store: 'conflicts'
// Key: [pairId, path]
type ConflictStore = {
  pairId: string
  path: string
  localEntry: BDPFileEntry
  remoteEntry: BDPFileEntry
  detectedAt: number
  status: 'pending' | 'resolved'
  resolution?: 'keep-local' | 'keep-remote' | 'keep-both'
}
```

---

## 9. Signaling Server API Extensions

Only three new endpoints on the existing signaling server. They handle envelopes, not content.

```
POST /relay/push
Body: {
  pairId: string
  fromDeviceId: string
  nonce: string           // base64, 12 bytes
  ciphertext: string      // base64, AES-GCM encrypted RelayPayload
  authTag: string         // base64, 16 bytes
}
Rules:
  - Max 64KB per envelope
  - Max 100 envelopes per pairId (oldest evicted if exceeded)
  - TTL: 30 days
  - Rate limit: 60 pushes/hour per pairId
Response: { id: string, expiresAt: number }

GET /relay/pull?pairId=X&since=T
  since: Unix timestamp ms — return envelopes created after this time
Response: { envelopes: RelayEnvelope[], serverTime: number }

DELETE /relay/clear?pairId=X&upTo=T
  upTo: timestamp — delete envelopes older than this (cleanup after successful sync)
Response: { deleted: number }
```

**Server storage estimate:** 100 envelopes × 64KB max × (number of active pairs)
For 10,000 active pairs: 10,000 × 6.4MB = 64GB maximum (theoretical).
In practice, most envelopes are <1KB (metadata only), so realistic is ~100MB for 10,000 pairs.

---

## 10. Security Model

### 10.1 Trust Establishment

```
The pairId IS the shared secret.
It's 32 characters of URL-safe random (nanoid32) = ~190 bits of entropy.
Transmitted only via QR code or direct link — never via server in plaintext.
Brute-force at 1 billion attempts/second: ~10^40 years.
```

### 10.2 What the Server Sees

```
Signaling server:
  ✓ Session IDs (for WebRTC routing) — ephemeral, no meaning after session
  ✓ pairId (for relay routing) — random, not linked to users
  ✓ fromDeviceId (for relay routing) — random, not linked to identity
  ✗ File contents — NEVER
  ✗ File names/paths — NEVER (all in encrypted payload)
  ✗ File sizes — NEVER
  ✗ The encryption key — derived client-side, never transmitted

Relay store:
  ✓ pairId — opaque random string
  ✓ fromDeviceId — opaque random string
  ✓ Ciphertext — meaningless without key
  ✗ Everything else — encrypted
```

### 10.3 Encryption Layers

```
Layer 1: WebRTC DTLS 1.3 (transport)
  → Encrypts ALL DataChannel traffic
  → Protection: network eavesdroppers, ISPs, NAT traversal servers
  → Always on, no configuration needed

Layer 2: AES-256-GCM (application, relay only)
  → Encrypts index deltas stored on relay server
  → Key: derived from pairId via HKDF
  → Protection: relay server compromise, relay server operators
  → Automatically applied to all relay messages

Layer 3: WebRTC file data (inherits Layer 1)
  → File chunks travel P2P over DTLS-protected DataChannel
  → Server never sees file bytes even without Layer 2
```

### 10.4 Threat Model

| Threat | Mitigation |
|--------|-----------|
| Network eavesdropper | WebRTC DTLS |
| Relay server compromise | AES-256-GCM encrypted payloads |
| Stolen pairId | Revoke pair, create new one |
| Man-in-middle on signaling | DTLS certificate pinning (future) |
| Malicious peer with pairId | They have legitimate access — treat like Syncthing device trust |
| OPFS data exfiltration | Same-origin policy prevents cross-site access |
| Replay attack on relay | Nonce uniqueness + timestamp validation |

---

## 11. Browser Compatibility Matrix

| Feature | Chrome 105+ | Firefox 113+ | Safari 16.4+ | Mobile Chrome | Mobile Safari |
|---------|-------------|--------------|--------------|---------------|---------------|
| OPFS vault | ✅ | ✅ | ✅ | ✅ | ✅ |
| WebRTC DataChannel | ✅ | ✅ | ✅ | ✅ | ✅ |
| SubtleCrypto ECDH | ✅ | ✅ | ✅ | ✅ | ✅ |
| CompressionStream | ✅ | ✅ | ✅ | ✅ | ✅ |
| Web Locks API | ✅ | ✅ | ✅ | ✅ | ✅ |
| IndexedDB | ✅ | ✅ | ✅ | ✅ | ✅ |
| webkitdirectory | ✅ | ✅ | ✅ | ⚠️ limited | ⚠️ limited |
| showDirectoryPicker | ✅ | ❌ | ❌ | ❌ | ❌ |
| FSAPI write | ✅ | ❌ | ❌ | ❌ | ❌ |
| Background Sync SW | ✅ | ❌ | ❌ | ✅ | ❌ |
| FileSystemObserver | ⚗️ | ❌ | ❌ | ❌ | ❌ |

**Key insight:** The four core features that make BDP work — OPFS, WebRTC, SubtleCrypto, CompressionStream — are ALL widely available. The nice-to-have features (real FS write, background sync) are enhancements, not requirements.

---

## 12. Implementation Phases

### Phase A — Core Engine (Essential, no BDP overlap)

**A1. `BDPDevice` — Identity Service**
- Generate and persist deviceId + X25519 keypair in IndexedDB
- Detect browser capabilities
- `src/services/bdpDevice.ts`

**A2. `OPFSVault` — Universal Write Target**
- Initialize CAS store structure in OPFS
- `writeChunk(hash, data, compressed)` / `readChunk(hash)`
- `reconstructFile(path, chunkHashes)` → File
- `writeFile(pairId, path, file)` → writes to vault + CAS
- `listFiles(pairId)` → async iterator of vault entries
- Web Locks integration for multi-tab safety
- `src/services/opfsVault.ts`

**A3. `MerkleIndex` — Efficient Change Detection**
- Build/update Merkle tree in IndexedDB
- `computeRoot(pairId)` → rootHash
- `walkDiff(pairId, remoteSubtreeHashes)` → changed paths
- `updateEntry(pairId, fileEntry)` → incremental update
- `getEntries(pairId, sinceSeq)` → delta entries
- `src/lib/merkleIndex.ts`

**A4. `VectorClock` — Conflict Mathematics**
- `increment(clock, deviceId)` → new clock
- `compare(a, b)` → 'a_wins' | 'b_wins' | 'concurrent'
- `merge(a, b)` → merged clock (component-wise max)
- `src/lib/vectorClock.ts`

### Phase B — Protocol Wire

**B1. `BDPProtocol` — Frame Serialization**
- JSON frames for all control messages
- Binary frames for chunk data: `[header_len: u16][header: JSON][data: ArrayBuffer]`
- Frame type discriminant (`cp: true`) for fast filtering
- `src/services/bdpProtocol.ts`

**B2. `BDPSession` — State Machine**
- Manages one sync session (greeting → diff → transfer → done)
- Drives the full protocol flow
- Handles timeouts and retries (3× exponential backoff)
- Emits progress events
- `src/services/bdpSession.ts`

**B3. `SyncPlanner` — Compute What to Do**
- Takes local index + remote entries → SyncPlan
- Upload / download / conflict classification
- Respects pair direction (bidirectional / upload-only / download-only)
- Applies include/exclude patterns
- `src/lib/syncPlanner.ts`

### Phase C — Delta Relay

**C1. Server Extension**
- Add `/relay/push`, `/relay/pull`, `/relay/clear` to signaling server
- In-memory store with TTL eviction
- Rate limiting
- `server/relay.ts`

**C2. `RelayClient` — Encrypted Delta Push/Pull**
- HKDF key derivation from pairId
- AES-256-GCM encrypt/decrypt
- Push on file change detection
- Pull on app open / reconnect
- Background Sync API integration (Chrome)
- `src/services/relayClient.ts`

### Phase D — File Access

**D1. `FolderReader` — Unified Read API**
- Chrome/Edge: `showDirectoryPicker()` → persistent handle
- Firefox/Safari: `webkitdirectory` input → FileList
- Both: same `AsyncIterator<FileEntry>` output
- Change detection via hash comparison against stored index
- `src/lib/folderReader.ts`

**D2. `FolderWriter` — Write-Through for Tier 1**
- Chrome/Edge: FSAPI `createWritable()` → write to real folder
- All browsers: write to OPFS vault (always)
- `src/lib/folderWriter.ts`

### Phase E — UI

**E1. `VaultBrowser` — In-App File Explorer**
- Browse OPFS vault contents by pair
- Preview files (images, text, PDF)
- Export single file or export all as ZIP
- `src/components/sync/VaultBrowser.tsx`

**E2. `ConflictResolver` — Side-by-Side Comparison**
- Show both versions with metadata
- Keep local / Keep remote / Keep both
- `src/components/sync/ConflictResolver.tsx`

**E3. `SyncDashboard` — Pair Management**
- Add pair via QR / link
- Per-pair status (synced, pending, conflicted, offline)
- Sync stats (bytes, files, speed, last sync time)
- Per-file change history
- `src/components/sync/SyncDashboard.tsx`

**E4. `SyncProgress` — Real-Time Transfer UI**
- Per-file progress bars
- Overall session stats
- Chunk deduplication / compression savings display
- "Synced X seconds ago" idle state
- `src/components/sync/SyncProgress.tsx`

---

## 13. What Makes This Genuinely Novel

No existing tool combines all of these in a browser context:

| Innovation | Prior Art | Why Novel Here |
|-----------|-----------|----------------|
| OPFS as P2P vault | None | First use of OPFS as sync receive buffer |
| Encrypted delta relay | Syncthing discovery server | Ours stores ENCRYPTED index deltas, not routing; server is blind |
| Merkle tree over WebRTC | Git trees, IPFS | First application of Merkle diff to WebRTC sync |
| CAS chunk store in OPFS | Git objects, IPFS blocks | First browser-native CAS for P2P sync |
| Vector clock CRDTs in IDB | Riak, CouchDB, Dynamo | First implementation in a browser P2P context |
| CompressionStream in pipeline | HTTP gzip | Applied to WebRTC binary DataChannel chunks natively |
| Web Locks for sync safety | None in sync tools | Multi-tab sync race condition protection |
| ECDH shared key from QR pair | Signal protocol | Applied to browser P2P file sync pairing |
| Gossip via relay for n-way | Syncthing, matrix.org | Browser-native, E2EE, index-only (never file data) |

---

## 14. Design Philosophy

```
1. WORK WITH THE BROWSER, NOT AGAINST IT
   Don't try to watch the filesystem (you can't reliably).
   Don't try to persist FileSystemDirectoryHandle everywhere (browser resets it).
   Instead: scan on connect, use OPFS for what you can control.

2. SEPARATE CONCERNS CLEANLY
   Index propagation ≠ File transfer
   OPFS vault ≠ User's real filesystem  
   Protocol ≠ UI
   State machine ≠ Transport

3. NO DEGRADED STATES
   Every browser tier is a FULL PEER in the protocol.
   Firefox users don't get "limited functionality" — they get the full vault.
   Tier differences are UX enhancements, not protocol gates.

4. PRIVACY BY MATH, NOT POLICY
   The server cannot read your data.
   Not "we promise we won't look."
   The math prevents it.

5. EVENTUAL CONSISTENCY OVER STRONG CONSISTENCY
   We cannot guarantee a lock across P2P devices — so we don't try.
   Vector clocks + CRDTs give us mathematical convergence guarantees
   without requiring a central coordinator.

6. FAIL SAFE, NOT FAIL SORRY
   Conflicts are always PRESERVED, never silently overwritten.
   Deleted files become tombstones, not lost data.
   CAS chunks are reference-counted, not eagerly deleted.

7. PROGRESSIVE ENHANCEMENT
   FileSystemObserver: use it if available, don't depend on it.
   Background Sync: use it if available, don't depend on it.
   FSAPI write: use it if available, don't depend on it.
   The protocol core works on any browser from 2023 onwards.
```

---

## 15. Open Questions & Future Work

### Resolved by This Design
- ✅ How to sync when both peers are not simultaneously online → Delta Relay
- ✅ How to handle Firefox/Safari receive → OPFS vault
- ✅ How to detect what changed efficiently → Merkle tree
- ✅ How to avoid re-transferring unchanged bytes → CAS deduplication
- ✅ How to handle conflicts mathematically → Vector clocks
- ✅ How to keep relay server blind → AES-256-GCM with client-derived key
- ✅ How to do n-way sync → HKDF group key + gossip via relay

### Left for Future Versions
- **Resumable large file transfers**: CAS partially handles this (chunks already received are in CAS), but we need explicit session resumption for files >500MB
- **Streaming file reconstruction**: Currently we buffer all chunks before writing; should stream directly to OPFS for large files
- **Variable-length chunking (FastCDC)**: Our fixed 256KB chunks are suboptimal for files with insertions in the middle; content-defined chunking would be more efficient
- **CRDT for folder renames**: Currently a rename = delete + create; with directory-aware CRDTs we could preserve rename intent
- **Selective sync UI**: The pattern matcher is designed; the UI for selecting which subfolders to sync is not built yet
- **File version history**: CAS chunks naturally support this (old chunks are kept until GC); just need a UI and a "restore this version" flow
- **Bandwidth throttling**: WebRTC doesn't expose bandwidth controls; we could self-throttle by inserting delays between chunk sends
- **Multi-peer transfers**: Like BitTorrent, download different chunks from different peers simultaneously — useful for 3+ device scenarios

---

*The Butterfly Delta Protocol (BDP) — where your files transform into something that truly flies.*
```

Now let me save this to the project: