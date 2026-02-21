# Sync Implementation — Butterfly Delta Protocol

> **This document supersedes all previous sync planning docs (`FOLDER_SYNC_PLAN.md`, `MULTI_PEER_PLAN.md`, the old `SYNC_IMPLEMENTATION.md`).**
> The canonical protocol design is in [`BDP_PROTOCOL.md`](./BDP_PROTOCOL.md).
> The canonical type definitions are in [`src/types/bdp.ts`](./src/types/bdp.ts).

---

## What We're Building

**The Butterfly Delta Protocol (BDP)** — a novel, browser-native, end-to-end encrypted, bidirectional file synchronization protocol that works on every modern browser without any installation.

Named after the butterfly's transformation stage. Files transform from ephemeral transfers into persistent, living sync relationships.

---

## Why Not Syncthing / Obsidian Sync / rsync?

| Tool | Why It Doesn't Fit |
|------|-------------------|
| Syncthing | Requires a native daemon process. Browsers can't run background processes. |
| Obsidian Sync | Requires a trusted cloud relay — files touch a server. Our goal is zero server file contact. |
| rsync | CLI tool, not browser-native. Can't write to arbitrary paths on Firefox/Safari. |
| Git | Requires a remote server (GitHub etc.). No browser-native delta sync. |

None of them work *with* the browser. BDP is designed from scratch around browser constraints and capabilities.

---

## The Ten Core Innovations

Read the full rationale in [`BDP_PROTOCOL.md`](./BDP_PROTOCOL.md). In brief:

1. **OPFS Sync Vault** — Origin Private File System as the universal write target. Zero permission, persistent, up to 60% of disk, works on Chrome + Firefox + Safari. No browser is second-class.

2. **Encrypted Delta Relay** — Our existing signaling server gets three new endpoints that store tiny encrypted index deltas (never file content). Peers learn about each other's changes even when not simultaneously online. The server is mathematically blind to the content.

3. **ECDH Shared Key** — During QR pair setup, both devices perform an X25519 Diffie-Hellman exchange. The resulting AES-256-GCM key is derived entirely client-side. The server never sees it. Used to encrypt relay payloads.

4. **Merkle Tree Index** — The file index is a Merkle tree stored in IndexedDB. Exchange root hashes first (O(1)). If equal: done instantly. If different: binary-search the tree to find exactly which files diverged — O(changed × log n) instead of O(all files).

5. **Content-Addressable Chunk Store (CAS)** — Every 256KB chunk of every file is stored in OPFS by its SHA-256 hash. Enables: resumable transfers (request only missing chunks), cross-file deduplication (identical blocks stored once), and efficient modified-file sync (only changed chunks transfer).

6. **Vector Clock CRDTs** — Each file entry carries a vector clock `{ [deviceId]: sequence }`. Conflict detection is mathematical, not heuristic. Any two index replicas can always be merged. Tombstones propagate deletes safely.

7. **Native Stream Compression** — Browser-native `CompressionStream` / `DecompressionStream` (available everywhere since May 2023) applied to chunk transfer. Text files shrink 60–80%. Binary files (already compressed) skip it automatically.

8. **Web Locks** — `navigator.locks.request()` prevents two browser tabs from simultaneously writing to the OPFS vault. Available on Chrome, Firefox, and Safari.

9. **Service Worker Delta Push** — On Chrome, `Background Sync API` pushes encrypted index deltas to the relay even after the tab is closed. On Firefox/Safari, pushes while the tab is open.

10. **Progressive Permission Model** — Tier 0 (any browser): OPFS vault + WebRTC. Tier 1 (Chrome/Edge): adds real-FS read via `showDirectoryPicker()` and optional write-through. The protocol never breaks; it only gets richer.

---

## Browser Compatibility

| Feature | Chrome | Firefox | Safari | Mobile Chrome | Mobile Safari |
|---------|--------|---------|--------|---------------|---------------|
| OPFS vault (receive) | ✅ | ✅ | ✅ | ✅ | ✅ |
| WebRTC DataChannel | ✅ | ✅ | ✅ | ✅ | ✅ |
| SubtleCrypto ECDH | ✅ | ✅ | ✅ | ✅ | ✅ |
| CompressionStream | ✅ | ✅ | ✅ | ✅ | ✅ |
| Web Locks | ✅ | ✅ | ✅ | ✅ | ✅ |
| IndexedDB | ✅ | ✅ | ✅ | ✅ | ✅ |
| Folder read (input) | ✅ | ✅ | ✅ | ⚠️ | ⚠️ |
| `showDirectoryPicker()` | ✅ | ❌ | ❌ | ❌ | ❌ |
| FSAPI write to real FS | ✅ | ❌ | ❌ | ❌ | ❌ |
| Background Sync API | ✅ | ❌ | ❌ | ✅ | ❌ |

**The four features that make the protocol work — OPFS, WebRTC, SubtleCrypto, CompressionStream — are universally available.**

---

## What the Server Sees

```
Signaling server:
  ✓ Session IDs       — ephemeral WebRTC routing tokens, no lasting meaning
  ✓ pairId            — opaque random string, not linked to users or files
  ✓ fromDeviceId      — opaque random string, not linked to identity
  ✓ Relay ciphertext  — AES-256-GCM encrypted blobs it cannot decrypt

  ✗ File contents     — NEVER
  ✗ File names/paths  — NEVER (inside encrypted relay payload)
  ✗ File sizes        — NEVER
  ✗ Encryption key    — derived client-side, never transmitted
```

Privacy is enforced by math, not policy.

---

## Codebase Structure

### Existing (Phase 1 — still valid, will be refactored into BDP)

```
src/types/sync.ts               → superseded by src/types/bdp.ts
src/services/syncStorage.ts     → IndexedDB schema will be expanded for BDP
src/services/syncProtocol.ts    → superseded by BDP wire protocol
src/lib/fileHashing.ts          → reused in BDPFileEntry.hash + CAS chunk hashes
src/lib/folderScanner.ts        → reused in FolderReader (Tier 0 fallback)
src/hooks/useFolderSync.ts      → reused for folder push (one-shot send)
src/components/sync/            → UI components will be redesigned for BDP
```

### New (Butterfly Delta Protocol — to be built)

```
src/types/bdp.ts          ✅ DONE — all type definitions

src/services/
  bdpDevice.ts                   → Device identity (deviceId, X25519 keypair, capabilities)
  opfsVault.ts                  → OPFS CAS + vault read/write + Web Locks
  bdpProtocol.ts                 → Frame serialization (JSON control + binary chunks)
  bdpSession.ts                  → State machine driving full sync lifecycle
  relayClient.ts                → Encrypted delta push/pull (HKDF + AES-GCM)

src/lib/
  merkleIndex.ts                → Merkle tree build/update/diff in IndexedDB
  vectorClock.ts                → ✅ DONE (in bdp.ts as pure functions)
  syncPlanner.ts                → Compute SyncPlan from two indexes
  folderReader.ts               → Unified FSAPI + webkitdirectory read API
  folderWriter.ts               → FSAPI write-through for Tier 1

src/hooks/
  useBDP.ts               → Main hook — wires all services, drives state machine

src/components/sync/
  SyncDashboard.tsx             → Pair management, status overview
  VaultBrowser.tsx              → In-app OPFS vault file explorer
  ConflictResolver.tsx          → Side-by-side conflict resolution UI
  SyncProgress.tsx              → Real-time transfer progress
  AddPairDialog.tsx             → QR scan / link entry to create a sync pair

server/
  relay.ts                      → Three new endpoints: /relay/push, /relay/pull, /relay/clear
```

---

## Implementation Phases

### Phase A — Core Engine (Start Here)

These are the foundational services. Everything else builds on them.

**A1. `bdpDevice.ts` — Identity Service**
- Generate persistent `deviceId` (nanoid 21) on first launch, store in IndexedDB
- Generate X25519 keypair via `crypto.subtle.generateKey`, store private key as non-extractable `CryptoKey`
- Detect and cache `BDPCapabilities`
- Export `publicKeyB64` for sharing during pair setup

**A2. `opfsVault.ts` — Universal Write Target**
- `initVault()` — create OPFS directory structure on first use
- `writeChunk(hash, data, compress?)` — write chunk to CAS with optional compression
- `readChunk(hash)` — read and optionally decompress chunk from CAS
- `hasChunk(hash)` — fast existence check
- `reconstructFile(pairId, path, chunkHashes)` — assemble file from CAS chunks
- `writeFileToVault(pairId, path, file)` — write a File object (chunks it, writes to CAS, reconstructs in vault)
- `listVaultFiles(pairId)` — async iterator over vault entries
- `deleteFromVault(pairId, path)` — mark as deleted (tombstone), GC orphaned CAS chunks
- All write operations use `navigator.locks.request()` for multi-tab safety

**A3. `merkleIndex.ts` — Efficient Change Detection**
- `updateEntry(pairId, fileEntry)` — insert or update a `BDPFileEntry`, recompute affected Merkle nodes up to root
- `getRoot(pairId)` — returns current `BDPIndexRoot` (cached)
- `getEntries(pairId, sinceSeq)` — returns all `BDPFileEntry` records with seq > sinceSeq (for delta queries)
- `walkDiff(pairId, remoteChildHashes, nodePath)` — compare a subtree node by node, return diverged leaf paths
- `applyDeltaEntries(pairId, entries)` — merge remote relay delta into local index (CRDT merge)

**A4. `syncPlanner.ts` — Decision Engine**
- Takes local `BDPIndexRoot` + remote `BDPFileEntry[]` → produces `BDPSyncPlan`
- Applies `SyncDirection` (bidirectional / upload-only / download-only)
- Applies include/exclude glob patterns
- Applies max file size filter
- Classifies each file: upload / download / conflict / skip
- Uses `compareVectorClocks()` (already in `bdp.ts`) for conflict detection

### Phase B — Protocol Wire

**B1. `bdpProtocol.ts` — Frame Serialization**
- `encodeFrame(frame: BDPFrame)` → `ArrayBuffer`
  - Control frames: `JSON.stringify` → UTF-8 bytes
  - Chunk frames: `[headerLen: u16][header JSON][chunk ArrayBuffer]`
- `decodeFrame(buf: ArrayBuffer)` → `BDPFrame | { type: 'BDP_CHUNK'; data: ArrayBuffer; header: BDPChunkFrame }`
- `isBDPFrame(msg: unknown)` — fast type guard using `cp: true` discriminant

**B2. `bdpSession.ts` — State Machine**
- One `BDPSession` instance per active WebRTC peer connection
- Implements the full state machine: `greeting → diffing → [delta|full]_sync → transferring → [resolving_conflict] → finalizing → idle`
- Drives all frame exchanges in correct order
- Tracks `activeTransfers`, emits progress events
- Retries failed chunks up to 3× with exponential backoff
- Emits `BDPEngineState` updates consumed by `useBDP` hook

### Phase C — Delta Relay

**C1. `server/relay.ts`**
- `POST /relay/push` — store encrypted `RelayEnvelope`, enforce 64KB limit, 100 envelopes/pair max, 30-day TTL
- `GET /relay/pull?pairId&since` — return envelopes since timestamp
- `DELETE /relay/clear?pairId&upTo` — cleanup after successful sync
- In-memory store with TTL eviction (or Redis if server supports it)
- Rate limit: 60 pushes/hour per pairId

**C2. `relayClient.ts`**
- `deriveGroupKey(pairId)` — HKDF from pairId → AES-256-GCM `CryptoKey`
- `encryptDelta(key, payload: RelayPayload)` → `{ nonce, ciphertext, authTag }`
- `decryptEnvelope(key, envelope: RelayEnvelope)` → `RelayPayload`
- `pushDelta(pairId, deltaEntries, merkleDelta)` — encrypt and POST to relay
- `pullDeltas(pairId)` — GET envelopes since `lastFetchedAt`, decrypt, return `RelayPayload[]`
- `registerBackgroundSync(pairId)` — Chrome Background Sync API integration
- Deduplication: track `appliedEnvelopeIds` in `RelayState` (IndexedDB) to avoid re-applying

### Phase D — File Access

**D1. `folderReader.ts`**
- `pickFolder()` — tries `showDirectoryPicker()` first, falls back to `<input webkitdirectory>`
- Returns `AsyncIterator<{ path, file: File, hash?: SHA256Hex }>` — same interface regardless of source
- `getStoredHandle(pairId)` — retrieve persisted `FileSystemDirectoryHandle` from IndexedDB (Chrome)
- `verifyPermission(handle)` — call `handle.requestPermission({ mode: 'read' })` if needed
- `scanFolder(handle | FileList)` — build `BDPFileEntry[]` by hashing all files
- `detectChanges(pairId, currentEntries)` — compare against stored index, return added/modified/deleted

**D2. `folderWriter.ts`** (Tier 1 Chrome/Edge only)
- `writeToRealFS(handle, path, data)` — write `ArrayBuffer` to a path in a `FileSystemDirectoryHandle`
- `ensureDirectory(handle, segments)` — recursively create intermediate directories
- `syncVaultToRealFS(pairId, handle)` — after receiving files, write them from OPFS vault to real FS

### Phase E — UI Components

**E1. `useBDP.ts` — Main Hook**
- Wraps `bdpSession`, `opfsVault`, `merkleIndex`, `relayClient`, `folderReader`
- Exposes `BDPEngineState` to React components
- Handles pair creation, peer connection events (from existing `useWebRTC_v2`)
- Triggers relay pull on app focus, relay push on file scan
- Auto-starts `BDPSession` when a peer with a matching `pairId` connects

**E2. UI Components**
- `SyncDashboard.tsx` — list all pairs, per-pair status badge, last-synced time, "Add Pair" button
- `VaultBrowser.tsx` — file tree view of OPFS vault, file preview for images/text, export buttons
- `ConflictResolver.tsx` — side-by-side diff of conflicting file versions, resolution buttons
- `SyncProgress.tsx` — per-file progress bars, speed, ETA, dedup/compression savings
- `AddPairDialog.tsx` — show QR code (as sender) or scan/enter link (as receiver) to create pair

---

## Key Design Decisions

### Why OPFS as primary receive target (not real FS)?

The alternative — writing directly to the user's chosen folder — only works on Chrome/Edge. OPFS works everywhere. We use OPFS as the universal target, and offer Chrome/Edge users an opt-in "Live Folder" mode that additionally writes to their real filesystem. This way Firefox and Safari users get 100% of the functionality, not a degraded experience.

### Why store encrypted deltas on the relay (not files)?

The relay is for **index propagation only** — just metadata (file paths, hashes, sizes, vector clocks). File content always flows P2P over WebRTC. The relay payload for a 10GB folder with 3 changed files is maybe 2KB of JSON. The server never touches your files.

This also means we never need to worry about relay storage costs — the cap is 100 × 64KB = ~6MB per pair.

### Why Merkle trees instead of just sending the full index?

For large folders (10,000+ files) where only a few files changed, sending the full index on every reconnect is wasteful. Merkle tree diffing finds the changed files in O(changed × log n) messages instead of O(n). For a 10,000-file folder with 3 changes: ~42 messages vs 10,000.

### Why vector clocks instead of just timestamps?

Clocks on different devices are not synchronized. A file modified "at 14:00" on device A and "at 14:01" on device B might actually be concurrent — device B just has a faster clock. Vector clocks track causality, not wall time. If A's change happened after B's, A's vector clock will dominate B's, regardless of wall-clock time.

### Why content-addressable chunks instead of whole-file transfer?

Two reasons:
1. **Resumability**: If a 500MB transfer drops at 90%, we resume from chunk 461 instead of restarting.
2. **Efficiency**: A 100MB log file where you appended 1MB only needs to transfer ~4MB (the new/changed chunks), not 100MB. This is the same technique rsync uses, but implemented natively in the browser via OPFS.

---

## Signaling Server Changes

The relay requires three new HTTP endpoints added to the existing Express/Node.js signaling server. These are the only server-side changes needed.

See the endpoint specifications in `BDP_PROTOCOL.md` § 9.

Estimated additional server load:
- Storage: ~100MB for 10,000 active pairs (envelope data is tiny metadata)
- Bandwidth: minimal — relay receives/sends only encrypted metadata, never files
- CPU: negligible — AES-GCM decryption happens client-side, server just stores/forwards

---

## Testing Strategy

### Unit Tests (Vitest)

- `vectorClock.ts` — comparison, merge, increment functions (pure, easy to test exhaustively)
- `merkleIndex.ts` — tree construction, hash recomputation, diff walk
- `syncPlanner.ts` — SyncPlan generation from various index combinations (upload/download/conflict scenarios)
- `bdpProtocol.ts` — frame encoding/decoding round-trips, binary chunk frame layout

### Integration Tests

- Full `BDPSession` state machine with two mock DataChannels
- OPFS vault write/read/reconstruct cycle
- Relay push/pull/decrypt round-trip

### E2E Tests (Playwright)

- Full sync flow: two browser contexts, pick folder, create pair, sync, verify vault
- Conflict scenario: both sides modify same file, verify conflict UI
- Offline scenario: push relay delta, reconnect, verify sync completes

---

## Milestone Checklist

### Phase A — Core Engine
- [ ] `bdpDevice.ts` — device identity + X25519 keypair generation
- [ ] `opfsVault.ts` — CAS + vault + Web Locks
- [ ] `merkleIndex.ts` — Merkle tree in IndexedDB
- [ ] `syncPlanner.ts` — SyncPlan computation

### Phase B — Protocol Wire
- [ ] `bdpProtocol.ts` — frame serialization
- [ ] `bdpSession.ts` — full state machine

### Phase C — Delta Relay
- [ ] `server/relay.ts` — three relay endpoints
- [ ] `relayClient.ts` — encrypt/decrypt + push/pull

### Phase D — File Access
- [ ] `folderReader.ts` — unified FSAPI + webkitdirectory
- [ ] `folderWriter.ts` — Tier 1 write-through

### Phase E — UI
- [ ] `useBDP.ts` — main hook
- [ ] `SyncDashboard.tsx`
- [ ] `VaultBrowser.tsx`
- [ ] `ConflictResolver.tsx`
- [ ] `SyncProgress.tsx`
- [ ] `AddPairDialog.tsx`

### Phase F — Testing
- [ ] Unit tests for core library functions
- [ ] Integration tests for BDPSession
- [ ] E2E tests for full sync flow

---

## References

- Full protocol specification: [`BDP_PROTOCOL.md`](./BDP_PROTOCOL.md)
- Type definitions: [`src/types/bdp.ts`](./src/types/bdp.ts)
- Syncthing Block Exchange Protocol (inspiration): https://docs.syncthing.net/specs/bep-v1.html
- OPFS MDN reference: https://developer.mozilla.org/en-US/docs/Web/API/File_System_API
- Web Locks MDN reference: https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API
- CompressionStream MDN reference: https://developer.mozilla.org/en-US/docs/Web/API/CompressionStream
- SubtleCrypto ECDH MDN reference: https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/deriveKey