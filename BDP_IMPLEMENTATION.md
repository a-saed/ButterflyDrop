# BDP — Butterfly Delta Protocol
## Detailed Implementation Guide

> This document is the authoritative reference for implementing BDP.
> Read it fully before writing a single line of code.
> Every file listed here maps 1:1 to a file you will create.

---

## Table of Contents

1. [Architecture Decision — Why `src/bdp/`](#1-architecture-decision)
2. [Module Structure](#2-module-structure)
3. [What to Keep, Reuse, Deprecate](#3-what-to-keep-reuse-deprecate)
4. [The 3 Integration Touch Points](#4-the-3-integration-touch-points)
5. [Phase A — Core Engine](#5-phase-a--core-engine)
6. [Phase B — Protocol Wire](#6-phase-b--protocol-wire)
7. [Phase C — Delta Relay](#7-phase-c--delta-relay)
8. [Phase D — File Access](#8-phase-d--file-access)
9. [Phase E — React Layer](#9-phase-e--react-layer)
10. [Phase F — UI Components](#10-phase-f--ui-components)
11. [Data Flow Diagrams](#11-data-flow-diagrams)
12. [Testing Strategy](#12-testing-strategy)
13. [Implementation Order](#13-implementation-order)
14. [Coding Standards](#14-coding-standards)

---

## 1. Architecture Decision

### Why `src/bdp/` (feature module)

BDP is ~15 files implementing a coherent, self-contained protocol. Scattering
them across `hooks/`, `lib/`, `services/` creates "feature spread" — you can
never find all BDP code in one place. A feature module keeps it cohesive.

```
WRONG — feature spread:
  src/hooks/useBDP.ts
  src/hooks/useBDPSession.ts
  src/lib/merkleIndex.ts        ← is this BDP? or something else?
  src/services/opfsVault.ts     ← same question
  src/components/sync/VaultBrowser.tsx

RIGHT — feature module:
  src/bdp/
    services/device.ts          ← all BDP services together
    services/opfsVault.ts
    lib/merkleIndex.ts          ← all BDP lib together
    hooks/useBDP.ts             ← all BDP hooks together
    components/VaultBrowser.tsx ← all BDP UI together
```

### Why inline (not a separate package)

BDP MUST share:
- `RTCDataChannel` instances from `useWebRTC_v2` — duplicating WebRTC is wrong
- `SignalingClient` — same server, BDP relay uses HTTP endpoints on it
- `useSession` / peer discovery — same session system
- `src/lib/fileHashing.ts` — SHA-256 implementation is already correct

The integration is exactly 3 touch points (see §4). Everything else is isolated.

### What BDP does NOT replace

- `useFileTransfer` — one-shot file sends still work for non-sync use
- `useFolderSync` — the "push folder" one-shot feature
- `useWebRTC_v2` — WebRTC connection management
- `SignalingClient` — WebSocket signaling

BDP **adds** sync capability. It does not replace the transfer UI.

---

## 2. Module Structure

```
src/bdp/
│
├── types.ts                    # Re-export from src/types/bdp.ts (barrel)
│
├── services/
│   ├── device.ts               # Phase A1 — Device identity + X25519 keypair
│   ├── opfsVault.ts            # Phase A2 — OPFS CAS + vault + Web Locks
│   ├── idb.ts                  # Phase A3 — IndexedDB schema + typed accessors
│   ├── merkleIndex.ts          # Phase A4 — Merkle tree build/update/diff
│   ├── syncPlanner.ts          # Phase A5 — Compute BDPSyncPlan from two indexes
│   ├── protocol.ts             # Phase B1 — Frame encode/decode
│   ├── session.ts              # Phase B2 — BDP session state machine
│   ├── relayClient.ts          # Phase C  — Encrypted delta push/pull
│   ├── folderReader.ts         # Phase D1 — FSAPI + webkitdirectory unified API
│   └── folderWriter.ts         # Phase D2 — FSAPI write-through (Tier 1)
│
├── hooks/
│   └── useBDP.ts               # Phase E  — Main React hook
│
└── components/
    ├── SyncDashboard.tsx        # Phase F1 — Pair list + status
    ├── AddPairDialog.tsx        # Phase F2 — QR / link pair setup
    ├── VaultBrowser.tsx         # Phase F3 — OPFS vault file explorer
    ├── ConflictResolver.tsx     # Phase F4 — Side-by-side conflict UI
    └── SyncProgress.tsx         # Phase F5 — Real-time transfer progress
```

Server extension:
```
server/src/
├── bdpRelay.ts                  # Phase C — Relay store + 3 endpoints
└── index.ts                     # Phase C — Register relay routes (3 lines added)
```

---

## 3. What to Keep, Reuse, Deprecate

### ✅ Keep and reuse unchanged

| File | How BDP uses it |
|------|----------------|
| `src/hooks/useWebRTC_v2.ts` | Call `getDataChannelForPeer(peerId)` to get the `RTCDataChannel` for BDP frames |
| `src/hooks/useFileTransfer.ts` | Add 2-line BDP frame discriminant at top of `handleMessage` |
| `src/services/signaling.ts` | BDP relay uses `fetch()` to the same server's HTTP endpoints; no WS changes |
| `src/lib/fileHashing.ts` | `calculateFileHash()` is used directly by `folderReader.ts` |
| `src/lib/sessionUtils.ts` | Session IDs for pairing |
| `src/hooks/useSession.ts` | Same session/peer model |
| `src/hooks/useFolderSync.ts` | One-shot folder push, still valid |

### ⚠️ Superseded (keep for now, deprecate later)

| File | Superseded by |
|------|--------------|
| `src/types/sync.ts` | `src/types/bdp.ts` |
| `src/services/syncProtocol.ts` | `src/bdp/services/protocol.ts` |
| `src/services/syncStorage.ts` | `src/bdp/services/idb.ts` |
| `src/lib/syncEngine.ts` | `src/bdp/services/syncPlanner.ts` |
| `src/lib/folderScanner.ts` | `src/bdp/services/folderReader.ts` |
| `src/components/sync/SyncSheet.tsx` | `src/bdp/components/SyncDashboard.tsx` |

Do NOT delete the superseded files yet. Keep them building and passing lint.
Remove them only after BDP UI is fully wired into App.tsx.

### ❌ Do not touch

Everything else in the codebase. BDP is additive.

---

## 4. The 3 Integration Touch Points

These are the only places in existing files that need modification.

### Touch Point 1 — `useFileTransfer.ts` message discriminant

In `handleMessage`, at the very top before any existing logic, add:

```typescript
// BDP frames are discriminated by the `cp` flag — forward to BDP engine
if (typeof message === 'object' && message !== null && (message as Record<string, unknown>).cp === true) {
  bdpMessageDispatch?.(peerId, message)
  return
}
```

The `bdpMessageDispatch` function is injected via a new optional param on the
hook, defaulting to `undefined` so the existing behaviour is completely unchanged
when BDP is not active.

The full signature change:

```typescript
// Before:
export function useFileTransfer()

// After:
export function useFileTransfer(options?: {
  onBDPFrame?: (peerId: string, frame: unknown) => void
})
```

### Touch Point 2 — `App.tsx` integration

Add the `useBDP` hook call alongside the existing hooks:

```typescript
const bdp = useBDP({
  getDataChannelForPeer,
  readyPeers,
})
```

Pass `bdp.handleFrame` as `onBDPFrame` to `useFileTransfer`.
Render `<SyncDashboard>` in the UI (exact placement TBD in Phase F).

### Touch Point 3 — `server/src/index.ts` relay endpoints

At the bottom, after the existing WebSocket server setup, add:

```typescript
import { registerBDPRelayRoutes } from './bdpRelay.js'
registerBDPRelayRoutes(httpServer)
```

That's it. Three touch points. Everything else is new code in `src/bdp/`.

---

## 5. Phase A — Core Engine

Implement these five files in order. Each depends on the previous.

---

### A1 — `src/bdp/services/device.ts`

**Purpose:** Persistent device identity. Generates and stores a `deviceId` and
an X25519 keypair on first launch. Detects browser capabilities.

**Dependencies:** `src/types/bdp.ts`, IndexedDB (direct, no idb.ts yet)

**Exports:**
```typescript
export async function getOrCreateDevice(): Promise<BDPDevice>
export async function getPublicKeyB64(): Promise<string>
export async function deriveECDHSharedKey(
  theirPublicKeyB64: string
): Promise<CryptoKey>
export async function deriveGroupKey(pairId: PairId): Promise<CryptoKey>
export function detectCapabilities(): BDPCapabilities
```

**Implementation notes:**

`getOrCreateDevice()`:
- Open IndexedDB `bdp-v1` manually (idb.ts is not ready yet, use raw IDBFactory)
- Check store `devices` for key `'self'`
- If exists: return it (re-detect capabilities to refresh them)
- If not: generate `deviceId` with `nanoid(21)`, generate X25519 keypair:
  ```typescript
  const keyPair = await crypto.subtle.generateKey(
    { name: 'X25519' },
    false,          // private key is non-extractable
    ['deriveKey']
  )
  ```
- Export public key as base64:
  ```typescript
  const rawPub = await crypto.subtle.exportKey('raw', keyPair.publicKey)
  const publicKeyB64 = btoa(String.fromCharCode(...new Uint8Array(rawPub)))
  ```
- Store the `BDPDevice` record. Store only the serialisable fields — the
  `CryptoKey` objects are stored in IndexedDB natively (they ARE serialisable
  to IDB).
- Return the full `BDPDevice`

`deriveECDHSharedKey(theirPublicKeyB64)`:
- Import their public key from base64:
  ```typescript
  const rawBytes = Uint8Array.from(atob(theirPublicKeyB64), c => c.charCodeAt(0))
  const theirPublicKey = await crypto.subtle.importKey(
    'raw', rawBytes, { name: 'X25519' }, false, []
  )
  ```
- Load our private key from IDB
- `crypto.subtle.deriveKey({ name: 'X25519', public: theirPublicKey }, ourPrivateKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])`
- Return the derived AES-256-GCM `CryptoKey`

`deriveGroupKey(pairId)`:
- Used for relay encryption when we don't have a peer's ECDH key yet
- Encode pairId as UTF-8 bytes
- Import as HKDF key material:
  ```typescript
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(pairId),
    'HKDF',
    false,
    ['deriveKey']
  )
  ```
- Derive AES-256-GCM key:
  ```typescript
  await crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(32), // zero salt
      info: new TextEncoder().encode(BDP_CONSTANTS.HKDF_INFO),
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
  ```

`detectCapabilities()`:
```typescript
{
  hasFSAPI: 'showDirectoryPicker' in window,
  hasOPFS: 'storage' in navigator && 'getDirectory' in navigator.storage,
  canWriteRealFS: 'showDirectoryPicker' in window, // same condition for now
  hasBackgroundSync: 'serviceWorker' in navigator && 'SyncManager' in window,
  hasFileObserver: 'FileSystemObserver' in window,
  compressionAlgos: detectCompressionAlgos(),
}
```

For `detectCompressionAlgos()`: try creating a `CompressionStream` with each
algo and catch if it throws. Cache the result since it doesn't change.

---

### A2 — `src/bdp/services/opfsVault.ts`

**Purpose:** The universal write target. Wraps OPFS with:
- A Content-Addressable Store (CAS) for chunks
- A vault directory for reconstructed files
- A temp directory for in-progress transfers
- Web Locks for multi-tab safety

**Dependencies:** `src/types/bdp.ts`, `BDP_CONSTANTS`

**Exports:**
```typescript
export async function initVault(): Promise<void>
export async function writeChunk(
  hash: SHA256Hex,
  data: ArrayBuffer,
  alreadyCompressed?: boolean
): Promise<void>
export async function readChunk(hash: SHA256Hex): Promise<ArrayBuffer>
export async function hasChunk(hash: SHA256Hex): Promise<boolean>
export async function deleteChunk(hash: SHA256Hex): Promise<void>
export async function reconstructFile(
  chunkHashes: SHA256Hex[]
): Promise<Blob>
export async function writeFileToVault(
  pairId: PairId,
  path: string,
  chunkHashes: SHA256Hex[]
): Promise<void>
export async function readFileFromVault(
  pairId: PairId,
  path: string
): Promise<Blob | null>
export async function deleteFromVault(
  pairId: PairId,
  path: string
): Promise<void>
export async function listVaultFiles(
  pairId: PairId
): Promise<VaultFileInfo[]>
export async function getVaultSize(): Promise<number>
```

**Implementation notes:**

OPFS path conventions (from `BDP_CONSTANTS`):
```
bdp/cas/{hash[0:2]}/{hash[2:]}     ← chunk storage
bdp/vault/{pairId}/{path}           ← reconstructed files
bdp/temp/{transferId}/{chunkHash}   ← in-progress
```

`initVault()`:
- `const root = await navigator.storage.getDirectory()`
- Create `bdp/`, `bdp/cas/`, `bdp/vault/`, `bdp/temp/` recursively
- Use `getDirectoryHandle(name, { create: true })` at each level
- Call once at app startup

`writeChunk(hash, data, alreadyCompressed)`:
- Acquire Web Lock: `navigator.locks.request('bdp-cas-write', async () => { ... })`
- Compute CAS path: `cas/{hash.slice(0,2)}/{hash.slice(2)}`
- Get or create the 2-char prefix directory
- Create file handle: `dirHandle.getFileHandle(hash.slice(2), { create: true })`
- Write: `const writable = await fileHandle.createWritable(); await writable.write(data); await writable.close()`
- If `!alreadyCompressed` and file is text-ish: attempt compression first
  - `const cs = new CompressionStream('deflate-raw'); ...`
  - Only store compressed if it's at least 10% smaller
  - Store a 1-byte prefix: `0x00` = raw, `0x01` = deflate-raw compressed

`readChunk(hash)`:
- Get file handle (no create)
- Read bytes
- Check first byte prefix to determine if compressed
- If compressed: decompress via `DecompressionStream`
- Return raw `ArrayBuffer`

`hasChunk(hash)`:
- Try `getFileHandle(hash.slice(2))` without `{ create: true }`
- Catch `NotFoundError` → return false
- Return true on success

`reconstructFile(chunkHashes)`:
- `const parts: ArrayBuffer[] = []`
- For each hash: `parts.push(await readChunk(hash))`
- `return new Blob(parts)`

`writeFileToVault(pairId, path, chunkHashes)`:
- Acquire Web Lock: `navigator.locks.request(`bdp-vault-${pairId}`, ...)`
- Reconstruct file from CAS: `const blob = await reconstructFile(chunkHashes)`
- Navigate/create path in `bdp/vault/{pairId}/`
- Split path by `/`, create each directory segment
- Write final file

`listVaultFiles(pairId)`:
- Walk `bdp/vault/{pairId}/` recursively
- For each file, build `VaultFileInfo`
- Infer `mimeType` from extension using a lookup table
- `previewable` = mimeType starts with `image/` or `text/`

---

### A3 — `src/bdp/services/idb.ts`

**Purpose:** Typed IndexedDB accessors for all BDP stores. Single source of
truth for the database schema. All other BDP services go through this module
to read/write IndexedDB.

**Dependencies:** `src/types/bdp.ts`, `BDP_CONSTANTS`

**Schema:**
```typescript
const STORES = {
  devices:      { keyPath: 'deviceId' },
  pairs:        { keyPath: 'pairId' },
  fileIndex:    { keyPath: ['pairId', 'path'] },   // composite key
  merkleNodes:  { keyPath: ['pairId', 'nodePath'] }, // composite key
  indexRoots:   { keyPath: 'pairId' },
  casIndex:     { keyPath: 'hash' },
  syncHistory:  { keyPath: ['pairId', 'timestamp'] },
  relayState:   { keyPath: 'pairId' },
  conflicts:    { keyPath: ['pairId', 'path'] },
} as const
```

Indexes:
- `fileIndex` by `[pairId, seq]` — for delta queries (`sinceSeq`)
- `fileIndex` by `[pairId, tombstone]` — for listing live files
- `casIndex` by `refCount` — for GC queries

**Exports:**
```typescript
// Database lifecycle
export async function openDB(): Promise<IDBDatabase>

// Generic typed helpers
export async function idbGet<T>(store: StoreName, key: IDBValidKey): Promise<T | undefined>
export async function idbPut<T>(store: StoreName, value: T): Promise<void>
export async function idbDelete(store: StoreName, key: IDBValidKey): Promise<void>
export async function idbGetAll<T>(store: StoreName): Promise<T[]>
export async function idbGetByIndex<T>(
  store: StoreName,
  indexName: string,
  query: IDBKeyRange | IDBValidKey
): Promise<T[]>

// Domain-specific accessors (thin wrappers for readability)
export async function getPair(pairId: PairId): Promise<SyncPair | undefined>
export async function putPair(pair: SyncPair): Promise<void>
export async function getAllPairs(): Promise<SyncPair[]>

export async function getFileEntry(pairId: PairId, path: string): Promise<BDPFileEntry | undefined>
export async function putFileEntry(entry: BDPFileEntry): Promise<void>
export async function getFileEntriesSince(pairId: PairId, sinceSeq: number): Promise<BDPFileEntry[]>
export async function getAllFileEntries(pairId: PairId): Promise<BDPFileEntry[]>

export async function getMerkleNode(pairId: PairId, nodePath: string): Promise<BDPMerkleNode | undefined>
export async function putMerkleNode(node: BDPMerkleNode): Promise<void>

export async function getIndexRoot(pairId: PairId): Promise<BDPIndexRoot | undefined>
export async function putIndexRoot(root: BDPIndexRoot): Promise<void>

export async function getRelayState(pairId: PairId): Promise<RelayState | undefined>
export async function putRelayState(state: RelayState): Promise<void>

export async function putConflict(conflict: ConflictRecord): Promise<void>
export async function getPendingConflicts(pairId: PairId): Promise<ConflictRecord[]>
export async function resolveConflict(pairId: PairId, path: string): Promise<void>
```

**Implementation notes:**

`openDB()`:
- Returns a singleton — open once, cache, reuse
- Use a promise-wrapping pattern around `indexedDB.open()`:
  ```typescript
  let dbPromise: Promise<IDBDatabase> | null = null
  export function openDB(): Promise<IDBDatabase> {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(BDP_CONSTANTS.IDB_DB_NAME, BDP_CONSTANTS.IDB_DB_VERSION)
        request.onupgradeneeded = (event) => {
          const db = (event.target as IDBOpenDBRequest).result
          createStores(db)
        }
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
    }
    return dbPromise
  }
  ```
- `createStores(db)`: iterate `STORES` definition, create each store and its indexes
- Handle version upgrades gracefully (check `event.oldVersion` before creating stores)

`getFileEntriesSince(pairId, sinceSeq)`:
- Use the `[pairId, seq]` index
- `IDBKeyRange.bound([pairId, sinceSeq + 1], [pairId, Infinity])`

General pattern for all typed helpers:
```typescript
export async function idbGet<T>(store: StoreName, key: IDBValidKey): Promise<T | undefined> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly')
    const req = tx.objectStore(store).get(key)
    req.onsuccess = () => resolve(req.result as T | undefined)
    req.onerror = () => reject(req.error)
  })
}
```

---

### A4 — `src/bdp/services/merkleIndex.ts`

**Purpose:** Build, update, and diff the Merkle tree. This is the heart of
efficient change detection. A single root hash fingerprints the entire folder.

**Dependencies:** `idb.ts`, `src/types/bdp.ts`

**Exports:**
```typescript
export async function updateEntry(
  pairId: PairId,
  entry: BDPFileEntry
): Promise<void>

export async function removeEntry(
  pairId: PairId,
  path: string
): Promise<void>

export async function getRoot(pairId: PairId): Promise<BDPIndexRoot | null>

export async function computeRoot(pairId: PairId): Promise<BDPIndexRoot>

export async function walkDiff(
  pairId: PairId,
  remoteChildren: Record<string, SHA256Hex>,
  nodePath: string
): Promise<string[]>  // returns diverged leaf paths

export async function applyDeltaEntries(
  pairId: PairId,
  entries: BDPFileEntry[]
): Promise<void>
```

**Implementation notes:**

The Merkle tree is stored as a flat set of `BDPMerkleNode` rows in IndexedDB,
keyed by `[pairId, nodePath]`. The tree is virtual — we only materialise the
nodes that exist.

**`updateEntry(pairId, entry)`:**
This is called every time a file changes locally (scan detects a change) or a
remote delta is applied.

```
1. putFileEntry(entry)                    ← write to fileIndex store
2. Compute the path segments:
   "src/utils/helper.ts" → ['src', 'utils', 'helper.ts']
3. Update the leaf Merkle node:
   hash = entry.hash (or a tombstone hash for deleted files)
4. Walk UP the tree from the leaf, recomputing each parent's hash:
   For each parent path '' / 'src' / 'src/utils':
     Load the MerkleNode from IDB
     Update childHashes[segment] = childHash
     Recompute node hash = SHA256(sortedChildHashes.join(''))
     Write back to IDB
5. Update BDPIndexRoot with new rootHash + maxSeq
```

Computing a node hash:
```typescript
async function hashNode(childHashes: Record<string, SHA256Hex>): Promise<SHA256Hex> {
  const sorted = Object.keys(childHashes).sort()
  const combined = sorted.map(k => childHashes[k]).join('')
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(combined))
  return toHex(buf) as SHA256Hex
}
```

**`walkDiff(pairId, remoteChildren, nodePath)`:**

Recursive diff walk. Called during the DIFFING phase when both peers are
exchanging `BDP_MERKLE` frames.

```
1. Load local MerkleNode for nodePath
2. For each segment in localNode.childHashes:
   a. If remoteChildren[segment] === localNode.childHashes[segment] → skip (identical)
   b. If remoteChildren[segment] is missing → this whole subtree is local-only
      → recurse with empty remoteChildren, add all leaves to result
   c. If hashes differ → recurse into this subtree (caller must request remote's
      BDP_MERKLE for the child path)
3. For each segment in remoteChildren not in localNode.childHashes:
   → remote-only subtree → add all remote leaves to result
4. Return flat array of diverged leaf paths
```

Note: `walkDiff` is called incrementally as `BDP_MERKLE` frames arrive. Each
call walks one level. The `BDPSession` coordinates multiple calls.

**`applyDeltaEntries(pairId, entries)`:**

Used when processing relay deltas:
```typescript
for (const entry of entries) {
  const existing = await getFileEntry(pairId, entry.path)
  if (!existing) {
    await updateEntry(pairId, entry)
    continue
  }
  // CRDT merge: keep the entry with the dominating vector clock
  const comparison = compareVectorClocks(entry.vectorClock, existing.vectorClock)
  if (comparison === 'a_wins' || comparison === 'identical') {
    await updateEntry(pairId, entry)
  }
  // b_wins or concurrent: keep existing (or mark as conflict)
}
```

---

### A5 — `src/bdp/services/syncPlanner.ts`

**Purpose:** Given our local index and the remote peer's index entries, compute
a `BDPSyncPlan` — exactly what to upload, download, and flag as conflicted.

**Dependencies:** `idb.ts`, `src/types/bdp.ts`, `compareVectorClocks` from `src/types/bdp.ts`

**Exports:**
```typescript
export async function computeSyncPlan(
  pairId: PairId,
  remoteEntries: BDPFileEntry[],
  pair: SyncPair
): Promise<BDPSyncPlan>

export function autoResolveConflict(
  conflict: BDPConflict,
  strategy: ConflictStrategy
): ConflictResolution | 'none'
```

**Implementation notes:**

`computeSyncPlan(pairId, remoteEntries, pair)`:

```typescript
const localEntries = await getAllFileEntries(pairId)
const localMap = new Map(localEntries.map(e => [e.path, e]))
const remoteMap = new Map(remoteEntries.map(e => [e.path, e]))

const upload: BDPFileEntry[] = []
const download: BDPFileEntry[] = []
const conflicts: BDPConflict[] = []
let unchangedCount = 0

// Check all local entries
for (const local of localEntries) {
  if (local.tombstone) continue  // we deleted it, skip unless...
  
  const remote = remoteMap.get(local.path)
  
  if (!remote) {
    // Local only — upload if direction allows
    if (pair.direction !== 'download-only') {
      upload.push(local)
    }
    continue
  }
  
  if (local.hash === remote.hash) {
    unchangedCount++
    continue
  }
  
  // Both have it, different hash — compare vector clocks
  const cmp = compareVectorClocks(local.vectorClock, remote.vectorClock)
  
  switch (cmp) {
    case 'a_wins':  // local dominates
      if (pair.direction !== 'download-only') upload.push(local)
      break
    case 'b_wins':  // remote dominates
      if (pair.direction !== 'upload-only') download.push(remote)
      break
    case 'concurrent': {
      const conflict: BDPConflict = {
        path: local.path,
        local,
        remote,
        autoResolution: autoResolveConflict({ path: local.path, local, remote, autoResolution: 'none' }, pair.conflictStrategy),
      }
      conflicts.push(conflict)
      break
    }
    case 'identical':
      unchangedCount++
      break
  }
}

// Check remote-only entries
for (const remote of remoteEntries) {
  if (remote.tombstone) {
    // Remote deleted a file — propagate if we have it
    const local = localMap.get(remote.path)
    if (local && !local.tombstone) {
      // Remote wants to delete something we have
      const cmp = compareVectorClocks(remote.vectorClock, local.vectorClock)
      if (cmp === 'a_wins') download.push(remote)  // remote tombstone wins
    }
    continue
  }
  if (!localMap.has(remote.path)) {
    if (pair.direction !== 'upload-only') download.push(remote)
  }
}

// Apply size filter
const filteredDownload = download.filter(e => e.size <= pair.maxFileSizeBytes)

// Apply include/exclude patterns
// (implement glob matching with a simple pattern matcher)

return {
  pairId,
  remotePeerDeviceId: remoteEntries[0]?.deviceId ?? ('' as DeviceId),
  upload,
  download: filteredDownload,
  conflicts,
  unchangedCount,
  computedAt: Date.now(),
}
```

`autoResolveConflict(conflict, strategy)`:
```typescript
switch (strategy) {
  case 'last-write-wins':
    return conflict.local.mtime >= conflict.remote.mtime ? 'keep-local' : 'keep-remote'
  case 'local-wins':
    return 'keep-local'
  case 'remote-wins':
    return 'keep-remote'
  case 'manual':
    return 'none'
}
```

---

## 6. Phase B — Protocol Wire

### B1 — `src/bdp/services/protocol.ts`

**Purpose:** Encode and decode BDP frames for the WebRTC DataChannel.
Two encoding formats:
- **Control frames** (all types except `BDP_CHUNK`): JSON text
- **Data frames** (`BDP_CHUNK`): binary — `[headerLen: u16][header JSON][chunk bytes]`

**Dependencies:** `src/types/bdp.ts`

**Exports:**
```typescript
export function encodeControlFrame(frame: Exclude<BDPFrame, BDPChunkFrame>): string

export function encodeChunkFrame(
  frame: BDPChunkFrame,
  chunkData: ArrayBuffer
): ArrayBuffer

export function decodeFrame(
  raw: string | ArrayBuffer
): { frame: BDPFrame; chunkData?: ArrayBuffer }

export function makeMsgId(): MsgId
export function makeTransferId(): TransferId
```

**Implementation notes:**

`encodeControlFrame(frame)`:
- `JSON.stringify(frame)` — the DataChannel sends text for control frames

`encodeChunkFrame(frame, chunkData)`:
```typescript
const headerJSON = JSON.stringify(frame)
const headerBytes = new TextEncoder().encode(headerJSON)
const headerLen = headerBytes.byteLength

// [u16 big-endian header length][header bytes][chunk bytes]
const buf = new ArrayBuffer(2 + headerLen + chunkData.byteLength)
const view = new DataView(buf)
view.setUint16(0, headerLen, false)  // big-endian
new Uint8Array(buf, 2, headerLen).set(headerBytes)
new Uint8Array(buf, 2 + headerLen).set(new Uint8Array(chunkData))
return buf
```

`decodeFrame(raw)`:
```typescript
if (typeof raw === 'string') {
  const frame = JSON.parse(raw) as BDPFrame
  return { frame }
}

// Binary — must be a BDP_CHUNK frame
const view = new DataView(raw)
const headerLen = view.getUint16(0, false)
const headerBytes = new Uint8Array(raw, 2, headerLen)
const frame = JSON.parse(new TextDecoder().decode(headerBytes)) as BDPChunkFrame
const chunkData = raw.slice(2 + headerLen)
return { frame, chunkData }
```

Fast type guard before any processing:
```typescript
export function isBDPMessage(raw: string | ArrayBuffer): boolean {
  if (typeof raw === 'string') {
    // Peek at the first chars without full parse
    return raw.includes('"cp":true') || raw.includes('"cp": true')
  }
  // Binary: always a BDP_CHUNK (only binary BDP frame type)
  return raw.byteLength > 4  // minimum viable frame
}
```

`makeMsgId()` / `makeTransferId()`:
- `nanoid(21) as MsgId` — import nanoid

---

### B2 — `src/bdp/services/session.ts`

**Purpose:** The BDP session state machine. Drives the full sync lifecycle for
one peer connection. One `BDPSession` instance per active peer.

**Dependencies:** All Phase A services, `protocol.ts`

**Exports:**
```typescript
export class BDPSession {
  constructor(options: BDPSessionOptions)

  // Lifecycle
  start(): Promise<void>    // begin GREETING phase
  stop(): void              // clean up, emit 'stopped'

  // Called by the hook when a BDP frame arrives from this peer
  handleFrame(frame: BDPFrame, chunkData?: ArrayBuffer): void

  // Event emitter interface
  on(event: 'stateChange', handler: (state: BDPEngineState) => void): () => void
  on(event: 'frame', handler: (frame: BDPFrame) => void): () => void
  on(event: 'stopped', handler: () => void): () => void
}

interface BDPSessionOptions {
  pairId: PairId
  myDeviceId: DeviceId
  peerDeviceId: DeviceId
  peerDeviceName: string
  dataChannel: RTCDataChannel
  device: BDPDevice
}
```

**Implementation notes:**

The session is a state machine. Keep the state in a private `_state: BDPEngineState`
field. All state transitions go through a single `_setState(partial)` method that
also emits `stateChange`.

**State transition map:**

```
idle
  → start() called → greeting

greeting
  → send BDP_HELLO
  → receive BDP_HELLO
  → compare merkleRoots for all shared pairIds:
      roots match         → emit 'no_change' → idle
      same indexId        → delta_sync
      different indexId   → full_sync

delta_sync / full_sync
  → send BDP_INDEX_REQUEST (sinceSeq: N or 0)
  → receive BDP_INDEX_RESPONSE (accumulate until isComplete)
  → computeSyncPlan()
  → if plan is empty   → finalizing
  → else               → transferring

transferring
  → for each file in plan.download: send BDP_CHUNK_REQUEST
  → for each incoming BDP_CHUNK_REQUEST: send chunks
  → max 3 concurrent transfers (upload + download combined)
  → on conflict: emit to UI, pause → resolving_conflict
  → all done → finalizing

resolving_conflict
  → wait for UI resolution → send BDP_CONFLICT_RESOLUTION
  → resume transferring

finalizing
  → update Merkle roots in IDB
  → push relay delta
  → emit CPSyncHistoryEntry
  → idle
```

**Sending a file (upload side):**
```typescript
private async _uploadFile(entry: BDPFileEntry): Promise<void> {
  const transferId = makeTransferId()
  // Update state: add to activeTransfers

  for (const chunkHash of entry.chunkHashes) {
    const chunkData = await readChunk(chunkHash)
    const frame: BDPChunkFrame = {
      cp: true, v: 1,
      type: 'BDP_CHUNK',
      pairId: this._options.pairId,
      msgId: makeMsgId(),
      fromDeviceId: this._options.myDeviceId,
      ts: Date.now(),
      payload: {
        transferId,
        chunkHash,
        chunkIndex: entry.chunkHashes.indexOf(chunkHash),
        isLast: chunkHash === entry.chunkHashes[entry.chunkHashes.length - 1],
        compressed: false,
        originalSize: chunkData.byteLength,
      }
    }
    const encoded = encodeChunkFrame(frame, chunkData)
    this._options.dataChannel.send(encoded)
  }
}
```

**Receiving a file (download side):**
```typescript
private async _handleChunk(frame: BDPChunkFrame, chunkData: ArrayBuffer): Promise<void> {
  // Write chunk to CAS immediately as it arrives
  await writeChunk(frame.payload.chunkHash, chunkData)

  if (frame.payload.isLast) {
    // Reconstruct and write to vault
    const entry = this._pendingDownloads.get(frame.payload.transferId)
    if (!entry) return
    await writeFileToVault(this._options.pairId, entry.path, entry.chunkHashes)

    // Update local index with the received entry + our device's vector clock
    const updatedEntry: BDPFileEntry = {
      ...entry,
      vectorClock: mergeVectorClocks(entry.vectorClock, {
        [this._options.myDeviceId]: this._device.localSeq
      }),
    }
    await updateEntry(this._options.pairId, updatedEntry)

    // Send ACK
    this._send({ type: 'BDP_ACK', payload: { transferId: frame.payload.transferId, path: entry.path, status: 'ok' } })
  }
}
```

**Concurrency control:**
- Maintain a `_concurrentCount: number` counter
- Before starting any upload/download: check `_concurrentCount < BDP_CONSTANTS.MAX_CONCURRENT_TRANSFERS`
- If at capacity: push to `_pendingQueue` and process when a transfer completes

**Retry logic:**
- Wrap each chunk send in try/catch
- On error: `_retryCount++`; if `>= BDP_CONSTANTS.MAX_RETRIES` → fatal error
- Else: `await delay(BDP_CONSTANTS.RETRY_BASE_DELAY_MS * 2 ** _retryCount)` → retry

---

## 7. Phase C — Delta Relay

### C1 — `server/src/bdpRelay.ts`

**Purpose:** Three HTTP endpoints on the existing signaling server.
Stores encrypted relay envelopes. Server is blind to content.

**Exports:**
```typescript
export function registerBDPRelayRoutes(server: http.Server): void
```

**In-memory store:**
```typescript
interface StoredEnvelope {
  id: string
  pairId: string
  fromDeviceId: string
  nonce: string
  ciphertext: string
  authTag: string
  size: number
  createdAt: number
  expiresAt: number
}

const relayStore = new Map<string, StoredEnvelope[]>()
// Key: pairId, Value: array of envelopes (newest last)
```

**Endpoints:**

```
POST /bdp/relay/push
  Body: RelayPushRequest (JSON)
  Validation:
    - pairId: string, 1–64 chars
    - fromDeviceId: string, 1–64 chars
    - nonce: base64, exactly 16 chars (12 bytes)
    - ciphertext: base64, max 87380 chars (65536 bytes encoded)
    - authTag: base64, exactly 24 chars (16 bytes)
  Logic:
    - Check total size <= BDP_CONSTANTS.RELAY_MAX_ENVELOPE_SIZE
    - Check envelope count for pairId <= BDP_CONSTANTS.RELAY_MAX_ENVELOPES_PER_PAIR
      If over limit: evict oldest
    - Rate limit: 60 pushes/hour per pairId (simple token bucket)
    - Assign id = crypto.randomUUID()
    - Set expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000
    - Store and return { id, expiresAt }

GET /bdp/relay/pull?pairId=X&since=T
  Validation: pairId required, since = number (default 0)
  Logic:
    - TTL eviction: filter out expired envelopes
    - Return envelopes where createdAt > since
    - Response: { envelopes: StoredEnvelope[], serverTime: Date.now() }

DELETE /bdp/relay/clear?pairId=X&upTo=T
  Logic:
    - Remove envelopes with createdAt < upTo for this pairId
    - Response: { deleted: number }
```

TTL eviction: run `setInterval` every 10 minutes to purge expired envelopes.

```typescript
setInterval(() => {
  const now = Date.now()
  for (const [pairId, envelopes] of relayStore.entries()) {
    const live = envelopes.filter(e => e.expiresAt > now)
    if (live.length === 0) relayStore.delete(pairId)
    else relayStore.set(pairId, live)
  }
}, 10 * 60 * 1000)
```

**`registerBDPRelayRoutes(server)`:**

Since the existing server uses raw `http.createServer`, parse request bodies
manually (no Express):

```typescript
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', chunk => body += chunk)
    req.on('end', () => resolve(body))
    req.on('error', reject)
  })
}
```

Route requests by checking `req.method` and `req.url` in the existing
`httpServer` request listener. Inject BDP routes before the existing
health-check handler.

---

### C2 — `src/bdp/services/relayClient.ts`

**Purpose:** Client-side relay push/pull. Encrypts before push,
decrypts after pull.

**Dependencies:** `device.ts`, `idb.ts`, `src/types/bdp.ts`, `signalingConfig.ts`

**Exports:**
```typescript
export async function pushDelta(
  pairId: PairId,
  device: BDPDevice,
  deltaEntries: BDPFileEntry[],
  newRoot: SHA256Hex
): Promise<void>

export async function pullDeltas(
  pairId: PairId
): Promise<RelayPayload[]>

export async function clearOldDeltas(
  pairId: PairId,
  upTo: number
): Promise<void>

export async function registerBackgroundSync(pairId: PairId): Promise<void>
```

**Implementation notes:**

`pushDelta(pairId, device, deltaEntries, newRoot)`:
```typescript
const key = await deriveGroupKey(pairId)
const relayState = await getRelayState(pairId) ?? defaultRelayState(pairId)

const payload: RelayPayload = {
  type: 'INDEX_DELTA',
  fromDeviceId: device.deviceId,
  deltaEntries,
  merkleDelta: {
    affectedPaths: deltaEntries.map(e => e.path),
    newRoot,
  },
  fromSeq: relayState.lastPushSeq,
  toSeq: device.localSeq,
  pushedAt: Date.now(),
}

// Encrypt
const nonce = crypto.getRandomValues(new Uint8Array(BDP_CONSTANTS.AES_NONCE_BYTES))
const plaintext = new TextEncoder().encode(JSON.stringify(payload))
const ciphertext = await crypto.subtle.encrypt(
  { name: 'AES-GCM', iv: nonce },
  key,
  plaintext
)

// AES-GCM ciphertext includes the auth tag in the last 16 bytes
const ctBytes = new Uint8Array(ciphertext)
const authTag = ctBytes.slice(-16)
const ctOnly = ctBytes.slice(0, -16)

const body: RelayPushRequest = {
  pairId,
  fromDeviceId: device.deviceId,
  nonce: toBase64(nonce),
  ciphertext: toBase64(ctOnly),
  authTag: toBase64(authTag),
}

const response = await fetch(`${getRelayBaseUrl()}/bdp/relay/push`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

if (!response.ok) throw new Error(`Relay push failed: ${response.status}`)

// Update relay state
await putRelayState({
  ...relayState,
  lastPushSeq: device.localSeq,
  pendingPush: false,
})
```

`pullDeltas(pairId)`:
```typescript
const relayState = await getRelayState(pairId)
const since = relayState?.lastFetchedAt ?? 0

const url = `${getRelayBaseUrl()}/bdp/relay/pull?pairId=${pairId}&since=${since}`
const response = await fetch(url)
if (!response.ok) return []

const { envelopes, serverTime } = await response.json() as RelayPullResponse
const key = await deriveGroupKey(pairId)
const existing = relayState?.appliedEnvelopeIds ?? []
const payloads: RelayPayload[] = []

for (const envelope of envelopes) {
  // Skip already-applied envelopes (idempotent)
  if (existing.includes(envelope.id)) continue

  try {
    const nonce = fromBase64(envelope.nonce)
    const ctOnly = fromBase64(envelope.ciphertext)
    const authTag = fromBase64(envelope.authTag)

    // Reassemble ciphertext + auth tag for AES-GCM
    const fullCt = new Uint8Array(ctOnly.byteLength + 16)
    fullCt.set(new Uint8Array(ctOnly))
    fullCt.set(new Uint8Array(authTag), ctOnly.byteLength)

    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: nonce },
      key,
      fullCt
    )
    const payload = JSON.parse(new TextDecoder().decode(decrypted)) as RelayPayload
    payloads.push(payload)
    existing.push(envelope.id)
  } catch {
    // Decryption failure = envelope not for us, or corrupted — skip silently
    console.warn('[BDP] Failed to decrypt relay envelope, skipping')
  }
}

// Update relay state
await putRelayState({
  ...(relayState ?? defaultRelayState(pairId)),
  lastFetchedAt: serverTime,
  appliedEnvelopeIds: existing.slice(-200), // keep last 200 IDs max
})

return payloads
```

`registerBackgroundSync(pairId)`:
```typescript
if (!('serviceWorker' in navigator)) return
try {
  const registration = await navigator.serviceWorker.ready
  await registration.sync.register(`bdp-push-${pairId}`)
  await putRelayState({ ...(await getRelayState(pairId) ?? defaultRelayState(pairId)), pendingPush: true })
} catch {
  // Background Sync not available — no-op
}
```

Helper:
```typescript
function getRelayBaseUrl(): string {
  // Re-use the existing signaling server URL logic from signalingConfig.ts
  // The HTTP base is the same host as the WS but with http:// scheme
  return import.meta.env.VITE_SIGNALING_URL?.replace('ws://', 'http://').replace('wss://', 'https://') ?? 'http://localhost:8080'
}
```

---

## 8. Phase D — File Access

### D1 — `src/bdp/services/folderReader.ts`

**Purpose:** Unified API for reading a folder. Hides the
`showDirectoryPicker()` vs `<input webkitdirectory>` difference. Returns
an identical `AsyncIterator<ScanEntry>` regardless of source.

**Dependencies:** `device.ts`, `idb.ts`, `src/lib/fileHashing.ts`

**Exports:**
```typescript
export interface ScanEntry {
  path: string          // relative, '/' separated
  file: File
  hash?: SHA256Hex      // populated only if hashAll = true
}

export interface PickResult {
  folderName: string
  handle: FileSystemDirectoryHandle | null  // null on Firefox/mobile
  entries: AsyncIterable<ScanEntry>
}

export async function pickFolder(options?: {
  hashAll?: boolean
}): Promise<PickResult | null>  // null = user cancelled

export async function scanHandle(
  handle: FileSystemDirectoryHandle,
  options?: { hashAll?: boolean }
): Promise<ScanEntry[]>

export async function detectChanges(
  pairId: PairId,
  currentEntries: ScanEntry[]
): Promise<{
  added: ScanEntry[]
  modified: ScanEntry[]
  deleted: BDPFileEntry[]  // files that were in index but are gone now
}>

export async function getStoredHandle(
  pairId: PairId
): Promise<FileSystemDirectoryHandle | null>

export async function storeHandle(
  pairId: PairId,
  handle: FileSystemDirectoryHandle
): Promise<void>

export async function verifyHandlePermission(
  handle: FileSystemDirectoryHandle
): Promise<boolean>
```

**Implementation notes:**

`pickFolder(options)`:
```typescript
// Try FSAPI first
if ('showDirectoryPicker' in window) {
  try {
    const handle = await (window as Window & {
      showDirectoryPicker(o?: { mode?: string }): Promise<FileSystemDirectoryHandle>
    }).showDirectoryPicker({ mode: 'readwrite' })
    const entries = scanHandle(handle, options)
    await storeHandle(pairId, handle)  // persist for later
    return { folderName: handle.name, handle, entries: asyncIterFromArray(await entries) }
  } catch (e) {
    if ((e as DOMException).name === 'AbortError') return null
    // Fall through to webkitdirectory
  }
}

// Fallback: <input webkitdirectory>
const files = await pickWithInput()
if (!files) return null
const folderName = (files[0] as File & { webkitRelativePath: string }).webkitRelativePath.split('/')[0]
const entries = Array.from(files).map(f => {
  const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath ?? f.name
  const path = rel.split('/').slice(1).join('/') || f.name
  return { path, file: f }
})
return { folderName, handle: null, entries: asyncIterFromArray(entries) }
```

`detectChanges(pairId, currentEntries)`:
- Load existing index entries: `await getAllFileEntries(pairId)`
- Build a map of path → stored entry
- For each current entry:
  - No stored entry → `added`
  - Stored entry with different size OR mtime → `modified` (do full hash to confirm)
  - Stored entry with same size AND mtime → unchanged (skip hash for speed)
- Files in stored index but not in currentEntries → `deleted`

`verifyHandlePermission(handle)`:
```typescript
const opts = { mode: 'readwrite' as const }
const perm = await handle.queryPermission(opts)
if (perm === 'granted') return true
const requested = await handle.requestPermission(opts)
return requested === 'granted'
```

---

### D2 — `src/bdp/services/folderWriter.ts`

**Purpose:** Write received files back to the real filesystem (Tier 1,
Chrome/Edge only). Falls back gracefully — the OPFS vault is always written
regardless.

**Dependencies:** `idb.ts`

**Exports:**
```typescript
export async function writeToRealFS(
  handle: FileSystemDirectoryHandle,
  path: string,
  data: Blob
): Promise<boolean>  // false = not supported or permission denied

export async function syncVaultToRealFS(
  pairId: PairId,
  handle: FileSystemDirectoryHandle,
  paths: string[]
): Promise<{ succeeded: number; failed: number }>

export function canWriteRealFS(): boolean
```

**Implementation notes:**

`writeToRealFS(handle, path, data)`:
```typescript
if (!canWriteRealFS()) return false
try {
  const segments = path.split('/')
  let dir = handle
  // Create intermediate directories
  for (const segment of segments.slice(0, -1)) {
    dir = await dir.getDirectoryHandle(segment, { create: true })
  }
  const fileName = segments[segments.length - 1]
  const fileHandle = await dir.getFileHandle(fileName, { create: true })
  const writable = await fileHandle.createWritable()
  await writable.write(data)
  await writable.close()
  return true
} catch {
  return false
}
```

`canWriteRealFS()`:
```typescript
return 'showDirectoryPicker' in window
```

---

## 9. Phase E — React Layer

### `src/bdp/hooks/useBDP.ts`

**Purpose:** The single React hook that wires all BDP services together.
Exposes `BDPEngineState` to components. Manages pair lifecycle. Handles
peer connection/disconnection events.

**Dependencies:** All Phase A–D services, `useWebRTC_v2`, `useSession`

**Signature:**
```typescript
interface UseBDPOptions {
  /** From useWebRTC_v2 */
  getDataChannelForPeer: (peerId: string) => RTCDataChannel | null
  /** From useWebRTC_v2 — triggers sync when a peer becomes ready */
  readyPeers: string[]
}

interface UseBDPReturn {
  // State
  engineStates: Map<PairId, BDPEngineState>
  pairs: SyncPair[]
  vaultFiles: Map<PairId, VaultFileInfo[]>
  pendingConflicts: Map<PairId, BDPConflict[]>

  // Actions
  createPair(options: CreatePairOptions): Promise<SyncPair>
  deletePair(pairId: PairId): Promise<void>
  triggerSync(pairId: PairId): Promise<void>
  resolveConflict(pairId: PairId, path: string, resolution: ConflictResolution): void
  exportVault(pairId: PairId): Promise<void>
  refreshVaultFiles(pairId: PairId): Promise<void>

  // Called by useFileTransfer when a BDP frame arrives
  handleFrame: (peerId: string, frame: unknown) => void

  // Device info
  device: BDPDevice | null
}

export function useBDP(options: UseBDPOptions): UseBDPReturn
```

**Implementation notes:**

```typescript
export function useBDP({ getDataChannelForPeer, readyPeers }: UseBDPOptions): UseBDPReturn {
  const [device, setDevice] = useState<BDPDevice | null>(null)
  const [pairs, setPairs] = useState<SyncPair[]>([])
  const [engineStates, setEngineStates] = useState(new Map<PairId, BDPEngineState>())
  const [vaultFiles, setVaultFiles] = useState(new Map<PairId, VaultFileInfo[]>())
  const sessionsRef = useRef(new Map<string, BDPSession>()) // key: peerId
  const prevReadyPeersRef = useRef<string[]>([])

  // Init on mount
  useEffect(() => {
    initVault().catch(console.error)
    getOrCreateDevice().then(d => {
      setDevice(d)
    }).catch(console.error)
    getAllPairs().then(setPairs).catch(console.error)
  }, [])

  // React to peer connections
  useEffect(() => {
    const newPeers = readyPeers.filter(id => !prevReadyPeersRef.current.includes(id))
    const gonepeers = prevReadyPeersRef.current.filter(id => !readyPeers.includes(id))
    prevReadyPeersRef.current = readyPeers

    // Stop sessions for gone peers
    for (const peerId of gonepeers) {
      sessionsRef.current.get(peerId)?.stop()
      sessionsRef.current.delete(peerId)
    }

    // Start sessions for new peers (if we have a matching pair)
    for (const peerId of newPeers) {
      // Check if any of our pairs has this peer
      const matchingPair = pairs.find(p => p.devices.some(d => d.deviceId === peerId))
      if (!matchingPair || !device) continue

      const dc = getDataChannelForPeer(peerId)
      if (!dc) continue

      const session = new BDPSession({
        pairId: matchingPair.pairId,
        myDeviceId: device.deviceId,
        peerDeviceId: peerId as DeviceId,
        peerDeviceName: matchingPair.devices.find(d => d.deviceId === peerId)?.deviceName ?? 'Unknown',
        dataChannel: dc,
        device,
      })

      session.on('stateChange', (state) => {
        setEngineStates(prev => new Map(prev).set(matchingPair.pairId, state))
      })

      sessionsRef.current.set(peerId, session)
      session.start().catch(console.error)
    }
  }, [readyPeers, pairs, device, getDataChannelForPeer])

  // Pull relay deltas on mount and focus
  useEffect(() => {
    const pullAll = async () => {
      if (!device) return
      for (const pair of pairs) {
        const payloads = await pullDeltas(pair.pairId)
        for (const payload of payloads) {
          await applyDeltaEntries(pair.pairId, payload.deltaEntries)
        }
      }
    }
    pullAll()
    window.addEventListener('focus', pullAll)
    return () => window.removeEventListener('focus', pullAll)
  }, [pairs, device])

  const handleFrame = useCallback((peerId: string, frame: unknown) => {
    const session = sessionsRef.current.get(peerId)
    if (!session) return
    const { frame: decoded, chunkData } = decodeFrame(frame as string | ArrayBuffer)
    session.handleFrame(decoded, chunkData)
  }, [])

  // ... rest of actions (createPair, deletePair, etc.)

  return { device, pairs, engineStates, vaultFiles, pendingConflicts, createPair, deletePair, triggerSync, resolveConflict, exportVault, refreshVaultFiles, handleFrame }
}
```

`createPair(options)`:
```typescript
async function createPair(options: CreatePairOptions): Promise<SyncPair> {
  const pairId = nanoid(32) as PairId
  const pair: SyncPair = {
    pairId,
    devices: [{
      deviceId: device!.deviceId,
      deviceName: device!.deviceName,
      publicKeyB64: device!.publicKeyB64,
      lastSeenAt: Date.now(),
    }],
    localFolder: {
      name: options.folderName,
      handle: options.handle ?? null,
      opfsPath: `${BDP_CONSTANTS.OPFS_VAULT}/${pairId}`,
      useRealFS: options.useRealFS ?? false,
    },
    direction: options.direction ?? 'bidirectional',
    conflictStrategy: options.conflictStrategy ?? 'last-write-wins',
    includePatterns: [],
    excludePatterns: [],
    maxFileSizeBytes: 500 * 1024 * 1024,
    createdAt: Date.now(),
    lastSyncedAt: null,
    lastRelayFetchedAt: null,
    localMerkleRoot: null,
    knownRemoteRoots: {},
  }
  await putPair(pair)
  setPairs(prev => [...prev, pair])
  return pair
}
```

---

## 10. Phase F — UI Components

### F1 — `src/bdp/components/SyncDashboard.tsx`

Shows all sync pairs, their status, and the "Add Pair" button.

**Props:**
```typescript
interface SyncDashboardProps {
  pairs: SyncPair[]
  engineStates: Map<PairId, BDPEngineState>
  onAddPair(): void
  onViewVault(pairId: PairId): void
  onDeletePair(pairId: PairId): void
  onSyncNow(pairId: PairId): void
}
```

Per-pair card shows:
- Folder name + peer device name
- Status badge (from `BDPEnginePhase`):
  - `idle` + `lastSyncedAt` < 5min → green "Synced"
  - `idle` + merkle roots differ → yellow "Pending"
  - `transferring` → blue "Syncing..."
  - `resolving_conflict` → orange "Conflict"
  - `error` → red "Error"
  - No peer online → grey "Offline"
- Last synced time (relative: "2 minutes ago")
- Bytes transferred in last session
- "Sync Now", "Browse Files", "Delete" actions

---

### F2 — `src/bdp/components/AddPairDialog.tsx`

Two modes: "Share" (sender creates pairId + shows QR) and "Join" (receiver
scans QR or pastes link).

Share mode:
1. Generate `pairId` (but don't save yet)
2. Show QR code: `btoa(JSON.stringify({ pairId, sessionId, publicKey: device.publicKeyB64 }))`
3. Wait for peer to connect (poll `readyPeers`)
4. On peer appears: complete pair setup, pick folder, save

Join mode:
1. Scan QR or paste link
2. Decode `pairId`, `sessionId`, `publicKey`
3. Join the session
4. Pick local folder
5. Save pair (with peer's publicKey)

---

### F3 — `src/bdp/components/VaultBrowser.tsx`

Browsable file tree from `VaultFileInfo[]`.

Features:
- Folder tree navigation
- File preview for images (`<img src={URL.createObjectURL(...)}>`) and text
- "Export File" button → triggers browser download
- "Export All as ZIP" button — use `CompressionStream` or a simple manual ZIP
  builder. For MVP: just loop and download each file individually.
- Status indicator per file: available (has all chunks) vs pending (missing chunks)

---

### F4 — `src/bdp/components/ConflictResolver.tsx`

Side-by-side view. Shown when `phase === 'resolving_conflict'`.

For each `BDPConflict`:
- Left panel: local file (name, size, mtime, first 500 chars if text)
- Right panel: remote file (same)
- Three buttons: "Keep Mine", "Keep Theirs", "Keep Both"
- "Keep Both" renames the losing version to `filename.{deviceName}.conflict`

---

### F5 — `src/bdp/components/SyncProgress.tsx`

Real-time progress during `phase === 'transferring'`.

Shows:
- Overall progress bar (bytes transferred / total bytes)
- Per-file row with individual progress bar
- Transfer direction icon (↑ upload / ↓ download)
- Speed in human-readable units (KB/s, MB/s)
- ETA in seconds/minutes
- "Bytes saved (dedup)" and "Bytes saved (compression)" counters

---

## 11. Data Flow Diagrams

### Full Sync Flow

```
APP OPEN
  │
  ├── initVault()              [OPFS: create directories]
  ├── getOrCreateDevice()      [IDB: get/create BDPDevice]
  ├── getAllPairs()             [IDB: load SyncPairs]
  └── pullDeltas(pairId)       [HTTP: GET /bdp/relay/pull]
       └── applyDeltaEntries() [IDB: update fileIndex + merkle]

PEER CONNECTS (readyPeers update)
  │
  ├── getDataChannelForPeer(peerId)
  ├── new BDPSession(...)
  └── session.start()
       │
       ├── send BDP_HELLO
       └── receive BDP_HELLO
            │
            ├── roots match → idle (nothing to do)
            │
            └── roots differ
                 │
                 ├── send BDP_INDEX_REQUEST
                 └── receive BDP_INDEX_RESPONSE
                      │
                      └── computeSyncPlan()
                           │
                           ├── upload files
                           │    └── for each file:
                           │         ├── send BDP_CHUNK_REQUEST (haveChunks=[])
                           │         └── for each chunk:
                           │              send BDP_CHUNK (binary)
                           │
                           ├── download files
                           │    └── for each file:
                           │         ├── receive BDP_CHUNK_REQUEST
                           │         └── for each needed chunk:
                           │              send BDP_CHUNK (binary)
                           │              └── receiver: writeChunk() → writeFileToVault()
                           │
                           └── finalizing
                                ├── updateEntry() × n   [IDB: update index]
                                ├── computeRoot()        [IDB: new merkle root]
                                ├── pushDelta()          [HTTP: POST /bdp/relay/push]
                                └── idle

FILE ARRIVES VIA DATACHANNEL (useFileTransfer.handleMessage)
  │
  ├── check cp === true → isBDPMessage?
  │    YES: bdpEngine.handleFrame(peerId, frame)
  │    NO:  existing transfer handling (unchanged)
  └── BDPSession.handleFrame(frame, chunkData?)
       └── route to appropriate handler by frame.type
```

### Relay Offline Flow

```
DEVICE A (online, makes changes)
  │
  ├── folderReader.detectChanges()
  ├── updateEntry() × n
  ├── computeRoot()
  └── pushDelta() → POST /bdp/relay/push
       └── server stores RelayEnvelope (encrypted)

DEVICE A goes offline

DEVICE B opens app (Device A is offline)
  │
  ├── pullDeltas(pairId) → GET /bdp/relay/pull
  ├── decryptEnvelope() (client-side, key derived from pairId)
  ├── applyDeltaEntries()  [IDB: update local index with A's changes]
  └── UI: "3 files pending from Device A (offline)"

DEVICE A comes back online
  │
  ├── WebRTC connects
  ├── BDP_HELLO exchange
  ├── merkle roots differ (B knows this already from relay delta)
  ├── delta_sync: sinceSeq = B's last known A seq
  └── transfer only the 3 changed files

All devices converge ✓
```

---

## 12. Testing Strategy

### Unit Tests (Vitest) — write these first

**`vectorClock.test.ts`** — pure functions, exhaustive:
```
compareVectorClocks(a, b) — 9 test cases covering all outcomes
mergeVectorClocks(a, b) — commutativity + associativity
incrementVectorClock(c, d) — immutability check
```

**`protocol.test.ts`** — round-trip tests:
```
encodeControlFrame → decodeFrame → same frame
encodeChunkFrame(frame, data) → decodeFrame → same frame + same data
binary layout: check headerLen u16 at bytes 0-1
```

**`syncPlanner.test.ts`** — scenario-based:
```
Scenario A: local only files → upload
Scenario B: remote only files → download
Scenario C: local newer (clock dominates) → upload
Scenario D: remote newer (clock dominates) → download
Scenario E: concurrent edits → conflict
Scenario F: direction='upload-only' → no downloads
Scenario G: tombstone propagation
Scenario H: file size filter
```

**`merkleIndex.test.ts`** — in-memory IDB mock:
```
updateEntry → root hash changes
updateEntry × 2 same path → root hash stable
walkDiff with identical subtree → no divergences
walkDiff with 1 different leaf → finds exactly 1 path
```

### Integration Tests

**Two mock DataChannels in same test:**
```typescript
// Create two BDPSession instances with cross-connected DataChannels
const [dcA, dcB] = createMockDataChannelPair()
const sessionA = new BDPSession({ ..., dataChannel: dcA })
const sessionB = new BDPSession({ ..., dataChannel: dcB })
await Promise.all([sessionA.start(), sessionB.start()])
// Verify both reach 'idle' with matching merkle roots
```

**OPFS round-trip:**
```
writeChunk → hasChunk(true) → readChunk → same bytes
writeChunk compressed text → readChunk → original bytes
writeFileToVault → listVaultFiles → file appears
```

**Relay encrypt/decrypt:**
```
pushDelta (mock fetch) → pullDeltas (mock fetch returning envelope) → same payload
pullDeltas with wrong pairId key → no payloads returned (decryption fails silently)
```

### E2E Tests (Playwright) — future

```
Two browser contexts, each opens the app
A creates pair, B joins (share QR link in test)
A picks a test folder (3 files)
B connects → sync starts → B's vault has 3 files
A modifies a file → reconnect → B's vault updates
Both modify same file offline → reconnect → conflict UI appears
```

---

## 13. Implementation Order

Follow this exact order. Each step builds on the previous.

```
Week 1 — Foundation
  [ ] A1: device.ts               — identity + crypto
  [ ] A2: opfsVault.ts            — OPFS write/read
  [ ] A3: idb.ts                  — database schema
  Write unit tests for A1, A2, A3 before moving on

Week 2 — Index & Planning
  [ ] A4: merkleIndex.ts          — tree operations
  [ ] A5: syncPlanner.ts          — sync plan computation
  Write unit tests for A4, A5

Week 3 — Protocol
  [ ] B1: protocol.ts             — frame encode/decode
  [ ] B2: session.ts              — state machine (greeting + index exchange)
  Write unit tests for B1

Week 4 — Protocol (continued)
  [ ] B2: session.ts              — transfer phase + finalizing
  [ ] Integration test: two sessions sync a small folder

Week 5 — Relay
  [ ] C1: server/bdpRelay.ts      — 3 HTTP endpoints
  [ ] C2: relayClient.ts          — push/pull with encryption
  [ ] Wire C1 into server/index.ts (Touch Point 3)

Week 6 — File Access
  [ ] D1: folderReader.ts         — FSAPI + webkitdirectory
  [ ] D2: folderWriter.ts         — FSAPI write-through

Week 7 — React Layer
  [ ] E:  useBDP.ts               — main hook
  [ ] Wire Touch Points 1 and 2 into useFileTransfer.ts + App.tsx

Week 8 — UI
  [ ] F1: SyncDashboard.tsx
  [ ] F2: AddPairDialog.tsx
  [ ] F3: VaultBrowser.tsx
  [ ] F4: ConflictResolver.tsx
  [ ] F5: SyncProgress.tsx
  [ ] Smoke test on Chrome + Firefox
```

---

## 14. Coding Standards

These apply to every file in `src/bdp/`. Follow them without exception.

### TypeScript

- **Strict mode is already on** — no `any`, no `as unknown as X` hacks
- Use branded types from `bdp.ts` for IDs: `nanoid(21) as DeviceId`
- Prefer `const` over `let`. Use `let` only when the variable is reassigned.
- All async functions must handle errors — never a floating Promise
- Use `void operator` to explicitly ignore Promises when intentional:
  `void session.start()` not `session.start()`

### Error handling

- OPFS errors: catch `QuotaExceededError` specifically, show user-friendly message
- IDB errors: always reject the returned Promise, never swallow silently
- Network errors (relay): catch and return empty result — relay is best-effort
- Crypto errors: let them propagate — they indicate a logic bug or security issue

### OPFS writes

- **Always** use `navigator.locks.request(lockName, ...)` before writing
- Lock names: `bdp-cas-write` for CAS, `bdp-vault-${pairId}` for vault
- Never hold a lock for more than one file operation — release and re-acquire

### Frame discrimination

- First thing in any message handler: check `isBDPMessage(raw)` or `isBDPFrame(parsed)`
- If not a BDP frame: return without doing anything — do not throw

### Imports

```typescript
// Group 1: External
import { nanoid } from 'nanoid'

// Group 2: Types (type-only imports, removed at build time)
import type { BDPDevice, PairId, SHA256Hex } from '@/types/bdp'
import type { BDPFileEntry } from '@/types/bdp'

// Group 3: BDP services (relative within src/bdp/)
import { openDB, putFileEntry } from './idb'
import { writeChunk, hasChunk } from './opfsVault'

// Group 4: Shared app utilities
import { calculateFileHash } from '@/lib/fileHashing'
import { BDP_CONSTANTS } from '@/types/bdp'
```

### File size

- Target max ~300 lines per file
- If a file grows beyond 400 lines: extract a helper module

### Comments

- JSDoc on every exported function: purpose, params, return, throws
- Inline comments only for non-obvious logic (not for self-explanatory code)
- `// TODO:` is acceptable for known gaps; `// FIXME:` for known bugs
- No commented-out code — delete it, git remembers

---

*This document is the single source of truth for BDP implementation.
When in doubt: refer here first, then to `BDP_PROTOCOL.md` for protocol details,
then to `src/types/bdp.ts` for type definitions.*