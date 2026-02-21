/**
 * BDP — Relay Client (C2)
 *
 * Client-side relay push/pull. All file data stays peer-to-peer; the relay
 * only stores encrypted Merkle index deltas so offline peers can catch up.
 *
 * Encryption model:
 *   - Key: HKDF-SHA-256 group key derived from pairId (see device.ts)
 *   - Algorithm: AES-256-GCM
 *   - Nonce: 12 random bytes per message (never reused)
 *   - The server receives only opaque base64 blobs — it is completely blind
 *     to the payload content, affected file paths, and device identities
 *     beyond the pairId routing key.
 *
 * Idempotency:
 *   - RelayState.appliedEnvelopeIds keeps the last 200 envelope IDs we have
 *     already processed. Any duplicate pulled from the server is skipped.
 *
 * Background Sync (Chrome only):
 *   - registerBackgroundSync() schedules a SW sync tag so the browser can
 *     push pending deltas even when the tab is not in the foreground.
 *
 * Dependencies: device.ts, idb.ts, src/types/bdp.ts
 */

import type {
  BDPDevice,
  BDPFileEntry,
  PairId,
  RelayPayload,
  RelayPullResponse,
  RelayPushRequest,
  RelayState,
  SHA256Hex,
} from "@/types/bdp";
import { BDP_CONSTANTS } from "@/types/bdp";
import { deriveGroupKey } from "./device";
import { getRelayState, putRelayState } from "./idb";

// ─────────────────────────────────────────────────────────────────────────────
// Base-64 helpers (browser built-ins, no library needed)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Encodes a Uint8Array / ArrayBuffer to a base64 string.
 */
function toBase64(bytes: Uint8Array | ArrayBuffer): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  // btoa works on binary strings
  return btoa(String.fromCharCode(...arr));
}

/**
 * Decodes a base64 string to an ArrayBuffer.
 */
function fromBase64(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

// ─────────────────────────────────────────────────────────────────────────────
// Default relay state factory
// ─────────────────────────────────────────────────────────────────────────────

function defaultRelayState(pairId: PairId): RelayState {
  return {
    pairId,
    lastPushSeq: 0,
    lastFetchedAt: 0,
    pendingPush: false,
    appliedEnvelopeIds: [],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Relay base URL resolution
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolves the HTTP base URL for relay endpoints.
 *
 * Re-uses the existing VITE_SIGNALING_URL environment variable, converting
 * the WebSocket scheme to HTTP. Falls back to localhost:8080 for development.
 *
 * Examples:
 *   ws://localhost:8080  → http://localhost:8080
 *   wss://api.example.com → https://api.example.com
 */
function getRelayBaseUrl(): string {
  const wsUrl = import.meta.env.VITE_SIGNALING_URL as string | undefined;
  if (!wsUrl) return "http://localhost:8080";
  return wsUrl
    .replace(/^wss:\/\//, "https://")
    .replace(/^ws:\/\//, "http://");
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Encrypts and pushes a Merkle index delta to the relay server.
 *
 * The payload includes the changed file entries and the new Merkle root so
 * that an offline peer can reconstruct the index diff when they come back
 * online — without needing a live WebRTC connection.
 *
 * The relay only sees encrypted bytes; it cannot read file paths, hashes,
 * device names, or any other payload content.
 *
 * @param pairId - The sync pair this delta belongs to
 * @param device - The local device (for deviceId + localSeq)
 * @param deltaEntries - File entries that changed since the last push
 * @param newRoot - The new Merkle root hash after applying the delta
 * @throws If the relay push fails (network error or server rejection)
 */
export async function pushDelta(
  pairId: PairId,
  device: BDPDevice,
  deltaEntries: BDPFileEntry[],
  newRoot: SHA256Hex,
): Promise<void> {
  const key = await deriveGroupKey(pairId);
  const relayState = (await getRelayState(pairId)) ?? defaultRelayState(pairId);

  const payload: RelayPayload = {
    type: "INDEX_DELTA",
    fromDeviceId: device.deviceId,
    deltaEntries,
    merkleDelta: {
      affectedPaths: deltaEntries.map((e) => e.path),
      newRoot,
    },
    fromSeq: relayState.lastPushSeq,
    toSeq: device.localSeq,
    pushedAt: Date.now(),
  };

  // ── Encrypt ────────────────────────────────────────────────────────────────

  const nonce = crypto.getRandomValues(
    new Uint8Array(BDP_CONSTANTS.AES_NONCE_BYTES),
  );
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));

  // AES-GCM produces ciphertext + 16-byte auth tag concatenated
  const ciphertextWithTag = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce },
    key,
    plaintext,
  );

  // Split off the last 16 bytes as the auth tag
  const ctBytes = new Uint8Array(ciphertextWithTag);
  const ctOnly = ctBytes.slice(0, -16);
  const authTag = ctBytes.slice(-16);

  const body: RelayPushRequest = {
    pairId,
    fromDeviceId: device.deviceId,
    nonce: toBase64(nonce),
    ciphertext: toBase64(ctOnly),
    authTag: toBase64(authTag),
  };

  // ── Send ───────────────────────────────────────────────────────────────────

  const response = await fetch(`${getRelayBaseUrl()}/bdp/relay/push`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => response.statusText);
    throw new Error(`BDP relay push failed (${response.status}): ${text}`);
  }

  // ── Update relay state ─────────────────────────────────────────────────────

  await putRelayState({
    ...relayState,
    lastPushSeq: device.localSeq,
    pendingPush: false,
  });
}

/**
 * Fetches and decrypts relay envelopes from the server.
 *
 * Pulls all envelopes created since the last successful pull (persisted in
 * RelayState.lastFetchedAt). Already-applied envelopes are skipped via the
 * appliedEnvelopeIds deduplication set.
 *
 * Decryption failures are silently skipped — an envelope that cannot be
 * decrypted was either not meant for us (wrong pairId key) or is corrupted.
 *
 * @param pairId - The sync pair to pull for
 * @returns Array of successfully decrypted RelayPayload objects
 */
export async function pullDeltas(pairId: PairId): Promise<RelayPayload[]> {
  const relayState = await getRelayState(pairId);
  const since = relayState?.lastFetchedAt ?? 0;

  // ── Fetch ──────────────────────────────────────────────────────────────────

  let response: Response;
  try {
    response = await fetch(
      `${getRelayBaseUrl()}/bdp/relay/pull?pairId=${encodeURIComponent(pairId)}&since=${since}`,
    );
  } catch {
    // Network error — relay is best-effort, return empty
    if (import.meta.env.DEV) {
      console.warn("[BDP relay] pull failed (network error)");
    }
    return [];
  }

  if (!response.ok) {
    if (import.meta.env.DEV) {
      console.warn(`[BDP relay] pull failed: ${response.status}`);
    }
    return [];
  }

  const { envelopes, serverTime } =
    (await response.json()) as RelayPullResponse;

  // ── Decrypt ────────────────────────────────────────────────────────────────

  const key = await deriveGroupKey(pairId);
  const appliedIds = [...(relayState?.appliedEnvelopeIds ?? [])];
  const payloads: RelayPayload[] = [];

  for (const envelope of envelopes) {
    // Skip envelopes we have already applied (idempotent pull)
    if (appliedIds.includes(envelope.id)) continue;

    try {
      const nonce = fromBase64(envelope.nonce);
      const ctOnly = fromBase64(envelope.ciphertext);
      const authTag = fromBase64(envelope.authTag);

      // Reassemble ciphertext + auth tag (AES-GCM expects them concatenated)
      const fullCt = new Uint8Array(ctOnly.byteLength + authTag.byteLength);
      fullCt.set(new Uint8Array(ctOnly), 0);
      fullCt.set(new Uint8Array(authTag), ctOnly.byteLength);

      const decrypted = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: nonce },
        key,
        fullCt,
      );

      const payload = JSON.parse(
        new TextDecoder().decode(decrypted),
      ) as RelayPayload;

      payloads.push(payload);
      appliedIds.push(envelope.id);
    } catch {
      // Wrong key, corrupt data, or replay — skip silently
      if (import.meta.env.DEV) {
        console.warn(
          `[BDP relay] Failed to decrypt envelope ${envelope.id} — skipping`,
        );
      }
    }
  }

  // ── Persist updated relay state ────────────────────────────────────────────

  await putRelayState({
    ...(relayState ?? defaultRelayState(pairId)),
    lastFetchedAt: serverTime,
    // Keep only the last 200 IDs to prevent unbounded growth
    appliedEnvelopeIds: appliedIds.slice(-200),
  });

  return payloads;
}

/**
 * Asks the relay server to delete envelopes older than a given timestamp.
 *
 * Should be called after a successful direct sync to clean up stale relay
 * data that both peers have already applied. Best-effort — failures are
 * silently ignored.
 *
 * @param pairId - The sync pair whose old envelopes to clear
 * @param upTo - Delete envelopes created before this Unix ms timestamp
 */
export async function clearOldDeltas(
  pairId: PairId,
  upTo: number,
): Promise<void> {
  try {
    const response = await fetch(
      `${getRelayBaseUrl()}/bdp/relay/clear?pairId=${encodeURIComponent(pairId)}&upTo=${upTo}`,
      { method: "DELETE" },
    );

    if (!response.ok && import.meta.env.DEV) {
      console.warn(`[BDP relay] clear failed: ${response.status}`);
    }
  } catch {
    // Best-effort — do not throw, relay cleanup is non-critical
    if (import.meta.env.DEV) {
      console.warn("[BDP relay] clear failed (network error)");
    }
  }
}

/**
 * Registers a Background Sync tag so the Service Worker can retry a pending
 * push when the browser has network connectivity (even if the tab is closed).
 *
 * Only available on Chrome/Edge with a registered Service Worker.
 * No-ops silently on unsupported browsers (Firefox, Safari).
 *
 * The SW must handle the 'sync' event with tag `bdp-push-${pairId}` and
 * call pushDelta() with the stored pending entries.
 *
 * @param pairId - The pair whose pending push should be retried by the SW
 */
export async function registerBackgroundSync(pairId: PairId): Promise<void> {
  if (!("serviceWorker" in navigator)) return;

  try {
    const registration = await navigator.serviceWorker.ready;

    // Background Sync API is not in TypeScript's default lib — cast safely
    const syncManager = (
      registration as ServiceWorkerRegistration & {
        sync?: { register: (tag: string) => Promise<void> };
      }
    ).sync;

    if (!syncManager) return; // not supported

    await syncManager.register(`bdp-push-${pairId}`);

    // Mark pending push in relay state so the SW knows what to do
    const existing = (await getRelayState(pairId)) ?? defaultRelayState(pairId);
    await putRelayState({ ...existing, pendingPush: true });

    if (import.meta.env.DEV) {
      console.log(`[BDP relay] Background Sync registered for pairId=${pairId}`);
    }
  } catch {
    // Background Sync not available or permission denied — no-op
  }
}

/**
 * Marks a pair as having a pending push (e.g. when the device goes offline
 * mid-sync). The Service Worker will pick this up via Background Sync.
 *
 * @param pairId - The sync pair with unsent changes
 */
export async function markPendingPush(pairId: PairId): Promise<void> {
  const existing = (await getRelayState(pairId)) ?? defaultRelayState(pairId);
  await putRelayState({ ...existing, pendingPush: true });
}

/**
 * Returns true if there is a pending relay push for this pair.
 * Used by the UI to show "changes pending sync" indicators.
 *
 * @param pairId - The sync pair to check
 */
export async function hasPendingPush(pairId: PairId): Promise<boolean> {
  const state = await getRelayState(pairId);
  return state?.pendingPush ?? false;
}
