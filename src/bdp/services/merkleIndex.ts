/**
 * BDP — Merkle Index Service (A4)
 *
 * Builds and maintains a virtual Merkle tree over the sync pair's file index.
 * A single root hash fingerprints the entire folder state — if two peers share
 * the same root hash, their indexes are identical (no sync needed).
 *
 * Tree structure:
 *   Root node  ('')       → hash of all top-level childHashes, sorted
 *   Dir node   ('src')    → hash of all src/ children
 *   Dir node   ('src/utils') → hash of src/utils/ children
 *   Leaf       ('src/utils/helper.ts') → entry.hash (file content hash)
 *
 * Storage:
 *   Nodes are persisted as flat BDPMerkleNode rows in IndexedDB, keyed by
 *   [pairId, nodePath]. The tree is virtual — we only materialise nodes that
 *   exist. A file deletion sets the leaf to a tombstone hash, not removes it,
 *   so we correctly propagate deletes to peers.
 *
 * Hash computation:
 *   node.hash = SHA-256(sorted childHashes values concatenated as hex strings)
 *   For leaf nodes: node.hash = entry.hash (the file content SHA-256)
 *
 * Dependencies: idb.ts, src/types/bdp.ts
 */

import type {
  BDPFileEntry,
  BDPIndexRoot,
  BDPMerkleNode,
  DeviceId,
  PairId,
  SHA256Hex,
} from "@/types/bdp";
import { BDP_CONSTANTS, compareVectorClocks } from "@/types/bdp";
import { nanoid } from "nanoid";
import {
  deleteFileEntry,
  getAllFileEntries,
  getFileEntry,
  getIndexRoot,
  getMerkleNode,
  putFileEntry,
  putIndexRoot,
  putMerkleNode,
} from "./idb";

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Converts an ArrayBuffer to a lowercase hex string.
 */
function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Computes the hash of a Merkle tree node from its children's hashes.
 *
 * The hash is deterministic: children are sorted alphabetically by segment
 * name before concatenation, ensuring the same tree always produces the
 * same root regardless of insertion order.
 *
 * @param childHashes - Map of child segment → child SHA-256 hash
 * @returns SHA-256 hex digest of the sorted, concatenated child hashes
 */
async function hashNode(
  childHashes: Record<string, SHA256Hex>,
): Promise<SHA256Hex> {
  const sorted = Object.keys(childHashes).sort();
  const combined = sorted.map((k) => childHashes[k]).join("");
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(combined),
  );
  return toHex(buf) as SHA256Hex;
}

/**
 * Computes a stable tombstone hash for a deleted file.
 * Uses a well-known prefix so callers can detect tombstones in the tree.
 * The path is included so each tombstone is unique.
 *
 * @param path - Relative file path
 * @returns A deterministic SHA-256 hash representing "this file is deleted"
 */
async function tombstoneHash(path: string): Promise<SHA256Hex> {
  const input = `__bdp_tombstone__:${path}`;
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );
  return toHex(buf) as SHA256Hex;
}

/**
 * Splits a file path into its parent node path and the final segment.
 *
 * Examples:
 *   "src/utils/helper.ts"  → { parent: "src/utils", segment: "helper.ts" }
 *   "README.md"            → { parent: "",           segment: "README.md" }
 *
 * @param filePath - Unix-style relative path
 */
function splitPath(filePath: string): { parent: string; segment: string } {
  const lastSlash = filePath.lastIndexOf("/");
  if (lastSlash === -1) {
    return { parent: "", segment: filePath };
  }
  return {
    parent: filePath.slice(0, lastSlash),
    segment: filePath.slice(lastSlash + 1),
  };
}

/**
 * Returns the parent path of a node path.
 *
 * Examples:
 *   "src/utils" → "src"
 *   "src"       → ""
 *   ""          → null  (root has no parent)
 *
 * @param nodePath - Node path within the tree
 */
function parentOf(nodePath: string): string | null {
  if (nodePath === "") return null;
  const lastSlash = nodePath.lastIndexOf("/");
  if (lastSlash === -1) return "";
  return nodePath.slice(0, lastSlash);
}

/**
 * Returns the final segment of a node path.
 *
 * Examples:
 *   "src/utils" → "utils"
 *   "src"       → "src"
 *   ""          → null  (root has no segment)
 *
 * @param nodePath - Node path within the tree
 */
function segmentOf(nodePath: string): string | null {
  if (nodePath === "") return null;
  const lastSlash = nodePath.lastIndexOf("/");
  if (lastSlash === -1) return nodePath;
  return nodePath.slice(lastSlash + 1);
}

/**
 * Updates a node's hash and writes it back to IDB, then propagates the change
 * upward through all ancestor nodes to the root.
 *
 * @param pairId - The sync pair
 * @param nodePath - The node whose hash has changed
 * @param newHash - The new hash value for this node
 * @param childSegment - (optional) If set, update this child hash in the parent
 */
async function propagateUp(
  pairId: PairId,
  nodePath: string,
  newHash: SHA256Hex,
): Promise<void> {
  // Walk up the ancestor chain and recompute each node's hash
  let currentPath: string | null = nodePath;
  let currentHash = newHash;

  while (currentPath !== null) {
    const parentPath = parentOf(currentPath);

    if (parentPath === null) {
      // currentPath is the root — update it and stop
      const rootNode = await getMerkleNode(pairId, currentPath);
      if (rootNode) {
        const updated: BDPMerkleNode = {
          ...rootNode,
          hash: currentHash,
          updatedAt: Date.now(),
        };
        await putMerkleNode(updated);
      }
      break;
    }

    // Load or create the parent node
    const segment = segmentOf(currentPath)!;
    const parentNode = await getMerkleNode(pairId, parentPath);

    let parentChildHashes: Record<string, SHA256Hex>;
    if (parentNode) {
      parentChildHashes = { ...parentNode.childHashes, [segment]: currentHash };
    } else {
      parentChildHashes = { [segment]: currentHash };
    }

    const parentHash = await hashNode(parentChildHashes);

    const updatedParent: BDPMerkleNode = {
      pairId,
      nodePath: parentPath,
      hash: parentHash,
      childHashes: parentChildHashes,
      childCount: Object.keys(parentChildHashes).length,
      updatedAt: Date.now(),
    };

    await putMerkleNode(updatedParent);

    currentPath = parentPath;
    currentHash = parentHash;
  }
}

/**
 * Collects all leaf file paths reachable from a given subtree root.
 * Used when the local or remote side has a subtree the other side lacks.
 *
 * @param pairId - The sync pair
 * @param nodePath - The subtree root to walk
 * @param fileEntries - All file entries for this pair (to identify leaves)
 * @returns Flat array of all leaf paths in the subtree
 */
async function collectAllLeaves(
  pairId: PairId,
  nodePath: string,
  fileEntries: Map<string, BDPFileEntry>,
): Promise<string[]> {
  const node = await getMerkleNode(pairId, nodePath);
  if (!node) return [];

  const leaves: string[] = [];

  for (const childSegment of Object.keys(node.childHashes)) {
    const childPath = nodePath ? `${nodePath}/${childSegment}` : childSegment;

    // Check if this child is a leaf (file) or an interior node (directory)
    if (fileEntries.has(childPath)) {
      // It's a file leaf
      leaves.push(childPath);
    } else {
      // It's a directory node — recurse
      const childLeaves = await collectAllLeaves(pairId, childPath, fileEntries);
      leaves.push(...childLeaves);
    }
  }

  return leaves;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Updates the index with a new or modified file entry, then recomputes the
 * Merkle tree upward from the affected leaf to the root.
 *
 * Must be called every time a file changes locally (detected by scan) or a
 * remote delta is applied. After this call, getRoot() will reflect the change.
 *
 * Steps:
 *  1. Write the BDPFileEntry to the fileIndex store
 *  2. Compute the leaf's Merkle hash (file hash, or tombstone hash if deleted)
 *  3. Write / update the leaf node
 *  4. Propagate the changed hash upward to the root
 *  5. Update BDPIndexRoot with the new root hash + maxSeq
 *
 * @param pairId - The sync pair
 * @param entry - The new or updated file entry
 */
export async function updateEntry(
  pairId: PairId,
  entry: BDPFileEntry,
): Promise<void> {
  // 1. Persist the file entry
  await putFileEntry(entry);

  // 2. Compute the leaf hash
  const leafHash: SHA256Hex = entry.tombstone
    ? await tombstoneHash(entry.path)
    : entry.hash;

  // 3. Determine the leaf node path and its parent
  const { parent: parentPath, segment: leafSegment } = splitPath(entry.path);

  // 4. Update the leaf's parent node (the directory containing this file)
  const parentNode = await getMerkleNode(pairId, parentPath);
  const parentChildHashes: Record<string, SHA256Hex> = parentNode
    ? { ...parentNode.childHashes, [leafSegment]: leafHash }
    : { [leafSegment]: leafHash };

  const parentHash = await hashNode(parentChildHashes);

  const updatedParent: BDPMerkleNode = {
    pairId,
    nodePath: parentPath,
    hash: parentHash,
    childHashes: parentChildHashes,
    childCount: Object.keys(parentChildHashes).length,
    updatedAt: Date.now(),
  };

  await putMerkleNode(updatedParent);

  // 5. Propagate up through ancestor nodes to the root
  await propagateUp(pairId, parentPath, parentHash);

  // 6. Update the IndexRoot
  await refreshIndexRoot(pairId, entry.seq);
}

/**
 * Removes a file entry from the index entirely (hard delete).
 *
 * Prefer marking as tombstone via updateEntry() when propagating deletes to
 * peers. Only use removeEntry() when the pair itself is deleted or during
 * index reset.
 *
 * @param pairId - The sync pair
 * @param path - Relative file path to remove
 */
export async function removeEntry(
  pairId: PairId,
  path: string,
): Promise<void> {
  // Remove from fileIndex store
  await deleteFileEntry(pairId, path);

  // Remove the leaf from its parent node's childHashes
  const { parent: parentPath, segment: leafSegment } = splitPath(path);
  const parentNode = await getMerkleNode(pairId, parentPath);

  if (!parentNode) return; // nothing to update

  const newChildHashes = { ...parentNode.childHashes };
  delete newChildHashes[leafSegment];

  if (Object.keys(newChildHashes).length === 0) {
    // Directory is now empty — cascade up: remove this node from its own parent
    await removeMerkleSubtree(pairId, parentPath);
    return;
  }

  const newHash = await hashNode(newChildHashes);
  const updatedParent: BDPMerkleNode = {
    ...parentNode,
    hash: newHash,
    childHashes: newChildHashes,
    childCount: Object.keys(newChildHashes).length,
    updatedAt: Date.now(),
  };

  await putMerkleNode(updatedParent);
  await propagateUp(pairId, parentPath, newHash);
  await refreshIndexRoot(pairId, 0);
}

/**
 * Returns the persisted BDPIndexRoot for a pair, or null if none exists yet.
 *
 * @param pairId - The sync pair
 * @returns Current BDPIndexRoot, or null if the index hasn't been computed
 */
export async function getRoot(pairId: PairId): Promise<BDPIndexRoot | null> {
  return (await getIndexRoot(pairId)) ?? null;
}

/**
 * Recomputes the entire Merkle tree from scratch by walking all file entries.
 *
 * This is a full rebuild — use only for:
 *  - First sync on a new device
 *  - After index corruption / reset
 *  - After bulk imports
 *
 * For incremental updates, use updateEntry() instead.
 *
 * @param pairId - The sync pair
 * @returns The freshly computed BDPIndexRoot
 */
export async function computeRoot(pairId: PairId): Promise<BDPIndexRoot> {
  const entries = await getAllFileEntries(pairId);

  // Build a fresh node map in memory, then flush to IDB
  const nodes = new Map<string, Record<string, SHA256Hex>>();

  // Ensure the root node exists
  nodes.set("", {});

  let maxSeq = 0;

  for (const entry of entries) {
    if (entry.seq > maxSeq) maxSeq = entry.seq;

    const leafHash: SHA256Hex = entry.tombstone
      ? await tombstoneHash(entry.path)
      : entry.hash;

    // Walk up from the file path and populate parent nodes
    const segments = entry.path.split("/");
    const filename = segments[segments.length - 1];

    // Build ancestor paths from root down to the file's parent dir
    const ancestorPaths: string[] = [""];
    for (let i = 0; i < segments.length - 1; i++) {
      ancestorPaths.push(segments.slice(0, i + 1).join("/"));
    }
    const parentPath = ancestorPaths[ancestorPaths.length - 1];

    // Register the leaf in its direct parent
    if (!nodes.has(parentPath)) nodes.set(parentPath, {});
    nodes.get(parentPath)![filename] = leafHash;

    // Ensure all intermediate directories exist in the map
    for (let i = 0; i < ancestorPaths.length - 1; i++) {
      const ancestorPath = ancestorPaths[i];
      const childSegment = segments[i]; // the segment that leads from ancestorPath to its child
      if (!nodes.has(ancestorPath)) nodes.set(ancestorPath, {});
      // The child's hash will be computed in the bottom-up pass below
      // (just ensure the map entry exists)
      void childSegment; // used below
    }
  }

  // Bottom-up hash computation:
  // Sort paths by depth (deepest first) so children are hashed before parents
  const sortedPaths = Array.from(nodes.keys()).sort(
    (a, b) => b.split("/").length - a.split("/").length,
  );

  const computedHashes = new Map<string, SHA256Hex>();

  for (const nodePath of sortedPaths) {
    const childHashes = nodes.get(nodePath)!;

    // Replace any child entries that refer to sub-directories with their
    // computed hashes (not file hashes)
    const finalChildHashes: Record<string, SHA256Hex> = {};
    for (const [seg, hash] of Object.entries(childHashes)) {
      const childPath = nodePath ? `${nodePath}/${seg}` : seg;
      finalChildHashes[seg] = computedHashes.has(childPath)
        ? computedHashes.get(childPath)!
        : hash;
    }

    const nodeHash = await hashNode(finalChildHashes);
    computedHashes.set(nodePath, nodeHash);

    await putMerkleNode({
      pairId,
      nodePath,
      hash: nodeHash,
      childHashes: finalChildHashes,
      childCount: Object.keys(finalChildHashes).length,
      updatedAt: Date.now(),
    });
  }

  const rootHash = computedHashes.get("") ?? ("" as SHA256Hex);
  const indexId = nanoid(21);

  const root: BDPIndexRoot = {
    pairId,
    deviceId: "" as DeviceId, // filled in by caller who has device context
    rootHash,
    entryCount: entries.length,
    maxSeq,
    indexId,
    computedAt: Date.now(),
  };

  await putIndexRoot(root);
  return root;
}

/**
 * Compares our local Merkle tree against the remote peer's advertised
 * childHashes for a given nodePath, returning all leaf paths that diverge.
 *
 * This is the core of the O(changed × log n) diff algorithm:
 *  - Identical subtrees are skipped in O(1) (hash comparison)
 *  - Only diverged subtrees are recursed into
 *
 * Called incrementally during the DIFFING phase: BDPSession issues one call
 * per BDP_MERKLE frame received. Each call walks ONE level. The session
 * accumulates diverged paths and issues BDP_MERKLE requests for sub-nodes.
 *
 * @param pairId - The sync pair
 * @param remoteChildren - The remote node's childHashes (segment → SHA256Hex)
 * @param nodePath - Which node we're comparing at ('' = root)
 * @returns Array of diverged leaf file paths (relative to sync root)
 */
export async function walkDiff(
  pairId: PairId,
  remoteChildren: Record<string, SHA256Hex>,
  nodePath: string,
): Promise<string[]> {
  const localNode = await getMerkleNode(pairId, nodePath);
  const allEntries = await getAllFileEntries(pairId);
  const fileMap = new Map(allEntries.map((e) => [e.path, e]));

  const diverged: string[] = [];

  // Check segments present in the local node
  if (localNode) {
    for (const [segment, localHash] of Object.entries(localNode.childHashes)) {
      const childPath = nodePath ? `${nodePath}/${segment}` : segment;
      const remoteHash = remoteChildren[segment];

      if (remoteHash === localHash) {
        // Identical subtree — skip entirely
        continue;
      }

      if (remoteHash === undefined) {
        // This subtree exists locally but not remotely — collect all leaves
        const leaves = await collectAllLeaves(pairId, childPath, fileMap);
        if (leaves.length > 0) {
          diverged.push(...leaves);
        } else if (fileMap.has(childPath)) {
          // The child IS a leaf file itself
          diverged.push(childPath);
        }
        continue;
      }

      // Hashes differ — this is a diverged subtree.
      // If the child is a leaf file, add it directly.
      // If it's a directory, the caller (BDPSession) will issue a
      // BDP_MERKLE request for childPath to recurse into it.
      if (fileMap.has(childPath)) {
        diverged.push(childPath);
      } else {
        // Return a sentinel indicating the SESSION needs to recurse.
        // Convention: prefix with '/' to distinguish from leaf paths.
        diverged.push(`__dir__:${childPath}`);
      }
    }
  }

  // Check segments present remotely but not locally
  for (const remoteSegment of Object.keys(remoteChildren)) {
    const childPath = nodePath
      ? `${nodePath}/${remoteSegment}`
      : remoteSegment;
    const localHash = localNode?.childHashes[remoteSegment];

    if (localHash !== undefined) continue; // already handled above

    // Remote has this subtree, we don't — everything in it is diverged
    diverged.push(`__remote_only__:${childPath}`);
  }

  return diverged;
}

/**
 * Applies a set of remote file entries to the local index, using CRDT merge.
 *
 * For each entry:
 *  - If we don't have it locally → accept the remote version
 *  - If the remote vector clock dominates our version → accept the remote
 *  - If our version dominates → keep local (discard remote)
 *  - If clocks are concurrent → keep local for now (mark as conflict upstream)
 *
 * This function does NOT create ConflictRecord entries — that's the
 * responsibility of SyncPlanner. This function is used for relay delta
 * application, where conflicts are handled at a higher level.
 *
 * @param pairId - The sync pair
 * @param entries - Remote file entries to apply
 */
export async function applyDeltaEntries(
  pairId: PairId,
  entries: BDPFileEntry[],
): Promise<void> {
  for (const entry of entries) {
    const existing = await getFileEntry(pairId, entry.path);

    if (!existing) {
      // No local version — accept the remote entry unconditionally
      await updateEntry(pairId, entry);
      continue;
    }

    // CRDT merge: keep the entry with the dominating vector clock
    const comparison = compareVectorClocks(
      entry.vectorClock,
      existing.vectorClock,
    );

    if (comparison === "a_wins" || comparison === "identical") {
      // Remote dominates or is the same — apply it
      await updateEntry(pairId, entry);
    }
    // 'b_wins'    → our local version is newer — keep it
    // 'concurrent' → conflict — leave local unchanged, let SyncPlanner handle it
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal tree maintenance
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Recursively removes a Merkle node and its ancestors (when a directory
 * becomes empty after a file deletion). Stops when an ancestor still has
 * other children.
 *
 * @param pairId - The sync pair
 * @param nodePath - The node to remove (must be empty)
 */
async function removeMerkleSubtree(
  pairId: PairId,
  nodePath: string,
): Promise<void> {
  if (nodePath === "") {
    // Root — just clear its childHashes
    const emptyHash = await hashNode({});
    await putMerkleNode({
      pairId,
      nodePath: "",
      hash: emptyHash,
      childHashes: {},
      childCount: 0,
      updatedAt: Date.now(),
    });
    await propagateUp(pairId, "", emptyHash);
    return;
  }

  // Remove this node from its parent
  const parentPath = parentOf(nodePath)!;
  const segment = segmentOf(nodePath)!;
  const parentNode = await getMerkleNode(pairId, parentPath);

  if (!parentNode) return;

  const newChildHashes = { ...parentNode.childHashes };
  delete newChildHashes[segment];

  if (Object.keys(newChildHashes).length === 0 && parentPath !== "") {
    // Parent is also empty — recurse upward
    await removeMerkleSubtree(pairId, parentPath);
    return;
  }

  const newHash = await hashNode(newChildHashes);
  await putMerkleNode({
    ...parentNode,
    hash: newHash,
    childHashes: newChildHashes,
    childCount: Object.keys(newChildHashes).length,
    updatedAt: Date.now(),
  });

  await propagateUp(pairId, parentPath, newHash);
}

/**
 * Refreshes the BDPIndexRoot after a tree update.
 *
 * Reads the current root node hash and entry count, then writes a new
 * BDPIndexRoot record. Preserves the existing indexId (it only changes on
 * a full computeRoot() rebuild).
 *
 * @param pairId - The sync pair
 * @param latestSeq - The seq of the entry that triggered this refresh
 */
async function refreshIndexRoot(
  pairId: PairId,
  latestSeq: number,
): Promise<void> {
  const rootNode = await getMerkleNode(pairId, "");
  const rootHash = rootNode?.hash ?? ("" as SHA256Hex);

  const existing = await getIndexRoot(pairId);
  const allEntries = await getAllFileEntries(pairId);

  const root: BDPIndexRoot = {
    pairId,
    deviceId: existing?.deviceId ?? ("" as DeviceId),
    rootHash,
    entryCount: allEntries.length,
    maxSeq: Math.max(existing?.maxSeq ?? 0, latestSeq),
    indexId: existing?.indexId ?? nanoid(21),
    computedAt: Date.now(),
  };

  await putIndexRoot(root);
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns a hex string representation of a SHA-256 digest for external use.
 * Exposed for tests and for other services that need to hash arbitrary data.
 *
 * @param data - String to hash
 * @returns Lowercase hex SHA-256 digest
 */
export async function sha256Hex(data: string): Promise<SHA256Hex> {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(data),
  );
  return toHex(buf) as SHA256Hex;
}

/**
 * Returns the current root hash for a pair, or null if no index exists.
 * Convenience shorthand over getRoot().
 *
 * @param pairId - The sync pair
 * @returns Root hash string, or null
 */
export async function getRootHash(pairId: PairId): Promise<SHA256Hex | null> {
  const root = await getRoot(pairId);
  return root?.rootHash ?? null;
}

/**
 * Returns a snapshot of the root node's childHashes.
 * Used when constructing BDP_MERKLE frames for the initial root exchange.
 *
 * @param pairId - The sync pair
 * @returns Map of top-level segment → hash, or {} if no tree exists
 */
export async function getRootChildren(
  pairId: PairId,
): Promise<Record<string, SHA256Hex>> {
  const rootNode = await getMerkleNode(pairId, "");
  return rootNode?.childHashes ?? {};
}

/**
 * Returns the childHashes of any interior node.
 * Used when constructing BDP_MERKLE frames for sub-node exchanges.
 *
 * @param pairId - The sync pair
 * @param nodePath - The node path to fetch
 * @returns Map of segment → hash, or {} if the node doesn't exist
 */
export async function getNodeChildren(
  pairId: PairId,
  nodePath: string,
): Promise<Record<string, SHA256Hex>> {
  const node = await getMerkleNode(pairId, nodePath);
  return node?.childHashes ?? {};
}

/**
 * Updates the BDPIndexRoot's deviceId field.
 * Called after getOrCreateDevice() resolves, since computeRoot() runs before
 * the device context is available in some startup sequences.
 *
 * @param pairId - The sync pair
 * @param deviceId - The local device's ID
 */
export async function setIndexRootDeviceId(
  pairId: PairId,
  deviceId: DeviceId,
): Promise<void> {
  const existing = await getIndexRoot(pairId);
  if (!existing) return;
  await putIndexRoot({ ...existing, deviceId });
}

/**
 * Returns true if the local root hash matches the provided remote root hash.
 * Fast-path check: if true, no sync is needed for this pair.
 *
 * @param pairId - The sync pair
 * @param remoteRootHash - The remote peer's advertised root hash
 * @returns true if in sync, false if a diff walk is needed
 */
export async function isInSyncWith(
  pairId: PairId,
  remoteRootHash: SHA256Hex,
): Promise<boolean> {
  const localRoot = await getRoot(pairId);
  if (!localRoot) return false;
  return localRoot.rootHash === remoteRootHash;
}

/**
 * Returns all active BDP_CONSTANTS relevant to Merkle operations.
 * Convenience re-export for callers that only import this module.
 */
export const MERKLE_CHUNK_SIZE = BDP_CONSTANTS.CHUNK_SIZE;
