/**
 * Sync Engine
 * Core sync logic separated from UI
 */

import type {
  FileSnapshot,
  SyncDiff,
  SyncPlan,
  SyncDirection,
  ConflictFile,
  ConflictResolutionAction,
} from "@/types/sync";

/**
 * Compare local and remote snapshots to determine differences
 */
export function compareSnapshots(
  local: FileSnapshot[],
  remote: FileSnapshot[],
): SyncDiff {
  const localMap = new Map(local.map((f) => [f.path, f]));
  const remoteMap = new Map(remote.map((f) => [f.path, f]));

  const localOnly: FileSnapshot[] = [];
  const remoteOnly: FileSnapshot[] = [];
  const modified: FileSnapshot[] = [];
  const unchanged: FileSnapshot[] = [];
  const conflicts: ConflictFile[] = [];

  // Check all local files
  for (const localFile of local) {
    const remoteFile = remoteMap.get(localFile.path);

    if (!remoteFile) {
      // File only exists locally
      localOnly.push(localFile);
    } else {
      // File exists on both sides - check if modified
      if (localFile.hash !== remoteFile.hash) {
        // File modified - check if it's a conflict
        if (
          localFile.lastModified > localFile.syncedAt &&
          remoteFile.lastModified > remoteFile.syncedAt
        ) {
          // Both modified since last sync - CONFLICT
          conflicts.push({
            path: localFile.path,
            local: localFile,
            remote: remoteFile,
          });
        } else {
          // One side modified - safe to sync
          modified.push(
            localFile.lastModified > remoteFile.lastModified
              ? localFile
              : remoteFile,
          );
        }
      } else {
        // Files identical
        unchanged.push(localFile);
      }
    }
  }

  // Check for remote-only files
  for (const remoteFile of remote) {
    if (!localMap.has(remoteFile.path)) {
      remoteOnly.push(remoteFile);
    }
  }

  return {
    localOnly,
    remoteOnly,
    modified,
    unchanged,
    conflicts,
  };
}

/**
 * Calculate sync plan based on diff and sync direction
 */
export function calculateSyncPlan(
  diff: SyncDiff,
  direction: SyncDirection,
): SyncPlan {
  const plan: SyncPlan = {
    upload: [],
    download: [],
    delete: [],
    conflicts: diff.conflicts,
  };

  switch (direction) {
    case "bidirectional":
      // Upload local-only and modified files where local is newer
      plan.upload = [
        ...diff.localOnly,
        ...diff.modified.filter((f) => {
          // Find if this is a local modification
          return diff.modified.some((m) => m.path === f.path);
        }),
      ];

      // Download remote-only files
      plan.download = [...diff.remoteOnly];
      break;

    case "upload-only":
      // Upload everything local
      plan.upload = [...diff.localOnly, ...diff.modified];
      // Don't download anything
      break;

    case "download-only":
      // Download everything remote
      plan.download = [...diff.remoteOnly, ...diff.modified];
      // Don't upload anything
      break;
  }

  return plan;
}

/**
 * Detect conflicts between local and remote snapshots
 */
export function detectConflicts(
  local: FileSnapshot[],
  remote: FileSnapshot[],
): ConflictFile[] {
  const conflicts: ConflictFile[] = [];
  const remoteMap = new Map(remote.map((f) => [f.path, f]));

  for (const localFile of local) {
    const remoteFile = remoteMap.get(localFile.path);

    if (remoteFile && localFile.hash !== remoteFile.hash) {
      // Check if both modified since last sync
      if (
        localFile.lastModified > localFile.syncedAt &&
        remoteFile.lastModified > remoteFile.syncedAt
      ) {
        conflicts.push({
          path: localFile.path,
          local: localFile,
          remote: remoteFile,
        });
      }
    }
  }

  return conflicts;
}

/**
 * Apply conflict resolutions to generate updated sync plan
 */
export function applyConflictResolutions(
  conflicts: ConflictFile[],
  resolutions: ConflictResolutionAction[],
): SyncPlan {
  const plan: SyncPlan = {
    upload: [],
    download: [],
    delete: [],
    conflicts: [],
  };

  const resolutionMap = new Map(resolutions.map((r) => [r.path, r.action]));

  for (const conflict of conflicts) {
    const resolution = resolutionMap.get(conflict.path);

    if (!resolution || resolution === "manual") {
      // Keep as unresolved conflict
      plan.conflicts.push(conflict);
      continue;
    }

    switch (resolution) {
      case "local":
        // Upload local version
        plan.upload.push(conflict.local);
        break;

      case "remote":
        // Download remote version
        plan.download.push(conflict.remote);
        break;

      case "both":
        // Keep both - rename one
        const renamedLocal: FileSnapshot = {
          ...conflict.local,
          path: generateConflictPath(conflict.local.path, "local"),
          name: generateConflictName(conflict.local.name, "local"),
        };
        plan.upload.push(renamedLocal);
        plan.download.push(conflict.remote);
        break;
    }
  }

  return plan;
}

/**
 * Generate conflict path by adding suffix
 */
function generateConflictPath(originalPath: string, suffix: string): string {
  const lastDotIndex = originalPath.lastIndexOf(".");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, -5);

  if (lastDotIndex === -1) {
    return `${originalPath} (${suffix}-${timestamp})`;
  }

  const pathWithoutExt = originalPath.slice(0, lastDotIndex);
  const ext = originalPath.slice(lastDotIndex);
  return `${pathWithoutExt} (${suffix}-${timestamp})${ext}`;
}

/**
 * Generate conflict name by adding suffix
 */
function generateConflictName(originalName: string, suffix: string): string {
  const lastDotIndex = originalName.lastIndexOf(".");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, -5);

  if (lastDotIndex === -1) {
    return `${originalName} (${suffix}-${timestamp})`;
  }

  const nameWithoutExt = originalName.slice(0, lastDotIndex);
  const ext = originalName.slice(lastDotIndex);
  return `${nameWithoutExt} (${suffix}-${timestamp})${ext}`;
}

/**
 * Merge two snapshots for bidirectional sync
 */
export function mergeSnapshots(
  local: FileSnapshot[],
  remote: FileSnapshot[],
): FileSnapshot[] {
  const merged = new Map<string, FileSnapshot>();

  // Add all local files
  for (const file of local) {
    merged.set(file.path, file);
  }

  // Add remote files, preferring newer versions
  for (const file of remote) {
    const existing = merged.get(file.path);
    if (!existing || file.lastModified > existing.lastModified) {
      merged.set(file.path, file);
    }
  }

  return Array.from(merged.values());
}
