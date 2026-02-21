/**
 * BDP — Sync Planner Service (A5)
 *
 * Given the local file index and a set of remote peer's file entries,
 * computes a BDPSyncPlan: the exact set of files to upload, download,
 * and flag as conflicted.
 *
 * The planner uses CRDT vector clock semantics for conflict detection:
 *   - local dominates remote  → upload
 *   - remote dominates local  → download
 *   - concurrent edits        → conflict (resolved per pair's conflictStrategy)
 *   - identical hash          → unchanged (skip)
 *
 * Tombstones (deletes) are handled correctly:
 *   - Remote tombstone dominates local file → download (propagate delete)
 *   - Local tombstone dominates remote file → upload (propagate our delete)
 *   - Concurrent tombstone vs live file     → conflict
 *
 * Size and pattern filters from the SyncPair config are applied to the
 * download list before returning the plan.
 *
 * Dependencies: idb.ts, src/types/bdp.ts
 */

import type {
  BDPConflict,
  BDPFileEntry,
  BDPSyncPlan,
  ConflictResolution,
  ConflictStrategy,
  DeviceId,
  PairId,
  SyncPair,
} from "@/types/bdp";
import { compareVectorClocks } from "@/types/bdp";
import { getAllFileEntries } from "./idb";

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Computes a sync plan by comparing the local file index with the remote
 * peer's entries. The plan tells the session exactly what to do next:
 * which files to upload, download, or surface as conflicts.
 *
 * The plan is computed in a single pass — O(local + remote) time.
 *
 * @param pairId - The sync pair being evaluated
 * @param remoteEntries - All file entries from the remote peer (including tombstones)
 * @param pair - The SyncPair config (direction, filters, conflict strategy)
 * @returns A BDPSyncPlan ready to hand to the transfer phase
 */
export async function computeSyncPlan(
  pairId: PairId,
  remoteEntries: BDPFileEntry[],
  pair: SyncPair,
): Promise<BDPSyncPlan> {
  const localEntries = await getAllFileEntries(pairId);
  const localMap = new Map(localEntries.map((e) => [e.path, e]));
  const remoteMap = new Map(remoteEntries.map((e) => [e.path, e]));

  const upload: BDPFileEntry[] = [];
  const download: BDPFileEntry[] = [];
  const conflicts: BDPConflict[] = [];
  let unchangedCount = 0;

  // ── Pass 1: Examine every local entry ─────────────────────────────────────

  for (const local of localEntries) {
    const remote = remoteMap.get(local.path);

    if (!remote) {
      // Local-only entry
      if (local.tombstone) {
        // We deleted a file the remote has never heard of — nothing to do
        continue;
      }
      // New local file the remote doesn't have yet
      if (pair.direction !== "download-only") {
        upload.push(local);
      }
      continue;
    }

    // Both sides have an entry for this path

    if (local.hash === remote.hash && local.tombstone === remote.tombstone) {
      // Identical state — nothing to do
      unchangedCount++;
      continue;
    }

    const cmp = compareVectorClocks(local.vectorClock, remote.vectorClock);

    switch (cmp) {
      case "identical":
        // Clocks are identical but hashes differ — treat as concurrent
        // (shouldn't happen in practice, but be defensive)
        pushConflict(conflicts, local, remote, pair.conflictStrategy);
        break;

      case "a_wins":
        // Our local version dominates — upload if direction allows
        if (pair.direction !== "download-only") {
          upload.push(local);
        }
        break;

      case "b_wins":
        // Remote dominates — download if direction allows
        if (pair.direction !== "upload-only") {
          download.push(remote);
        }
        break;

      case "concurrent":
        // Neither dominates — conflict
        pushConflict(conflicts, local, remote, pair.conflictStrategy);
        break;
    }
  }

  // ── Pass 2: Examine remote-only entries ───────────────────────────────────

  for (const remote of remoteEntries) {
    if (localMap.has(remote.path)) {
      // Already handled in pass 1
      continue;
    }

    if (remote.tombstone) {
      // Remote deleted a file we've never indexed — nothing to do
      continue;
    }

    // Remote has a file we've never seen
    if (pair.direction !== "upload-only") {
      download.push(remote);
    }
  }

  // ── Filters ───────────────────────────────────────────────────────────────

  // Apply size filter (skip files that exceed the pair's maxFileSizeBytes)
  const filteredDownload = download.filter(
    (e) => e.size <= pair.maxFileSizeBytes,
  );

  // Apply include/exclude glob patterns
  const patternedUpload = applyPatternFilters(
    upload,
    pair.includePatterns,
    pair.excludePatterns,
  );
  const patternedDownload = applyPatternFilters(
    filteredDownload,
    pair.includePatterns,
    pair.excludePatterns,
  );

  // ── Derive remotePeerDeviceId ─────────────────────────────────────────────

  // Use the deviceId from the first non-tombstone remote entry,
  // falling back to the first entry of any kind
  const firstRemote =
    remoteEntries.find((e) => !e.tombstone) ?? remoteEntries[0];
  const remotePeerDeviceId: DeviceId =
    firstRemote?.deviceId ?? ("" as DeviceId);

  return {
    pairId,
    remotePeerDeviceId,
    upload: patternedUpload,
    download: patternedDownload,
    conflicts,
    unchangedCount,
    computedAt: Date.now(),
  };
}

/**
 * Attempts to automatically resolve a conflict using the pair's strategy.
 *
 * @param conflict - The conflict to resolve
 * @param strategy - The pair's configured conflict resolution strategy
 * @returns A ConflictResolution, or 'none' if manual resolution is required
 */
export function autoResolveConflict(
  conflict: BDPConflict,
  strategy: ConflictStrategy,
): ConflictResolution | "none" {
  switch (strategy) {
    case "last-write-wins":
      // Compare wall-clock mtimes — the newer one wins
      return conflict.local.mtime >= conflict.remote.mtime
        ? "keep-local"
        : "keep-remote";

    case "local-wins":
      return "keep-local";

    case "remote-wins":
      return "keep-remote";

    case "manual":
      return "none";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Creates a BDPConflict record and pushes it onto the conflicts array.
 * Automatically computes the autoResolution from the pair's strategy.
 *
 * @param conflicts - Accumulator array
 * @param local - Local file entry
 * @param remote - Remote file entry
 * @param strategy - Pair's conflict resolution strategy
 */
function pushConflict(
  conflicts: BDPConflict[],
  local: BDPFileEntry,
  remote: BDPFileEntry,
  strategy: ConflictStrategy,
): void {
  const stub: BDPConflict = {
    path: local.path,
    local,
    remote,
    autoResolution: "none",
  };
  conflicts.push({
    ...stub,
    autoResolution: autoResolveConflict(stub, strategy),
  });
}

/**
 * Filters a list of file entries by include/exclude glob patterns.
 *
 * Rules (mirrors gitignore semantics):
 *  1. If includePatterns is non-empty, only entries matching at least one
 *     include pattern are kept.
 *  2. Entries matching any exclude pattern are removed (applied after includes).
 *  3. Empty includePatterns = include everything.
 *  4. Tombstone entries always pass through (we need to propagate deletes).
 *
 * @param entries - Entries to filter
 * @param includePatterns - Whitelist globs (empty = all pass)
 * @param excludePatterns - Blacklist globs (empty = none excluded)
 * @returns Filtered entry array
 */
function applyPatternFilters(
  entries: BDPFileEntry[],
  includePatterns: string[],
  excludePatterns: string[],
): BDPFileEntry[] {
  if (includePatterns.length === 0 && excludePatterns.length === 0) {
    return entries;
  }

  return entries.filter((entry) => {
    // Tombstones always propagate regardless of patterns
    if (entry.tombstone) return true;

    const path = entry.path;

    // Apply include filter (if any patterns are specified)
    if (includePatterns.length > 0) {
      const included = includePatterns.some((pattern) =>
        matchGlob(pattern, path),
      );
      if (!included) return false;
    }

    // Apply exclude filter
    if (excludePatterns.length > 0) {
      const excluded = excludePatterns.some((pattern) =>
        matchGlob(pattern, path),
      );
      if (excluded) return false;
    }

    return true;
  });
}

/**
 * Minimal glob matcher supporting the following syntax:
 *
 *   *      — matches any sequence of non-separator characters
 *   **     — matches any sequence including path separators
 *   ?      — matches exactly one non-separator character
 *   [abc]  — character class (literal characters only, no ranges)
 *   alternation syntax (e.g. "a,b" inside braces) — converted to regex alternation
 *
 * This is intentionally simple. A full gitignore engine is out of scope for
 * MVP. File paths use '/' as the separator regardless of OS.
 *
 * @param pattern - Glob pattern
 * @param path - Unix-style relative file path to test
 * @returns true if the path matches the pattern
 */
function matchGlob(pattern: string, path: string): boolean {
  try {
    const regex = globToRegex(pattern);
    return regex.test(path);
  } catch {
    // Malformed pattern — skip it (don't crash, don't filter)
    return true;
  }
}

/**
 * Converts a glob pattern string to a RegExp.
 *
 * @param pattern - Glob pattern
 * @returns Compiled RegExp
 */
function globToRegex(pattern: string): RegExp {
  // Expand {a,b,c} alternations first
  const expanded = expandAlternations(pattern);

  let regexStr = "^";
  let i = 0;

  while (i < expanded.length) {
    const ch = expanded[i];

    if (ch === "*") {
      if (expanded[i + 1] === "*") {
        // ** — matches everything including path separators
        regexStr += ".*";
        i += 2;
        // Consume a following '/' if present so "src/**" matches "src/a/b"
        if (expanded[i] === "/") i++;
      } else {
        // * — matches anything except '/'
        regexStr += "[^/]*";
        i++;
      }
    } else if (ch === "?") {
      regexStr += "[^/]";
      i++;
    } else if (ch === "[") {
      // Character class — find the closing ']'
      const end = expanded.indexOf("]", i + 1);
      if (end === -1) {
        // Unclosed bracket — treat '[' as a literal
        regexStr += "\\[";
        i++;
      } else {
        const inner = expanded.slice(i + 1, end);
        // Escape regex metacharacters inside the class (except '-' and '^')
        regexStr += `[${inner.replace(/[.+*?^${}()|\\]/g, "\\$&")}]`;
        i = end + 1;
      }
    } else {
      // Escape regex metacharacters
      regexStr += ch.replace(/[.+*?^${}()|[\]\\]/g, "\\$&");
      i++;
    }
  }

  regexStr += "$";
  return new RegExp(regexStr);
}

/**
 * Expands `{a,b,c}` alternation syntax in a glob pattern.
 * Supports one level of nesting. Non-nested patterns are returned as-is.
 *
 * Examples:
 *   "*.{ts,tsx}" → "(*.ts|*.tsx)"
 *   "{src,lib}/**" → "(src/**|lib/**)"
 *
 * @param pattern - Glob pattern potentially containing alternations
 * @returns Regex-safe alternation string
 */
function expandAlternations(pattern: string): string {
  return pattern.replace(/\{([^}]+)\}/g, (_match, inner: string) => {
    const alternatives = inner.split(",").map((alt) => alt.trim());
    return `(${alternatives.join("|")})`;
  });
}
