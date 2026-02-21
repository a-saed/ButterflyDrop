/**
 * BDP — React Layer (Phase E)
 *
 * `useBDP` is the single hook that wires every BDP service into React state.
 * It owns the lifecycle of BDPSession instances, reacts to peer connection
 * changes, polls the relay, surfaces conflicts, and exposes all UI-facing
 * actions.
 *
 * Architecture:
 *   - One BDPSession per active peer connection (keyed by WebRTC peerId)
 *   - Sessions are created when a peer becomes ready and a matching SyncPair exists
 *   - Sessions are destroyed when the peer disconnects
 *   - Relay is pulled on mount and on window focus
 *
 * Integration touch points:
 *   - useWebRTCContext() → getDataChannelForPeer, readyPeers
 *   - useFileTransfer → handleFrame (called when a BDP message arrives)
 *   - App.tsx → renders <SyncDashboard> with the values returned here
 *
 * Dependencies: All Phase A–D services
 */

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { nanoid } from "nanoid";

import type {
  BDPConflict,
  BDPDevice,
  BDPEngineState,
  ConflictResolution,
  DeviceId,
  PairId,
  SyncDirection,
  ConflictStrategy,
  SyncPair,
  VaultFileInfo,
} from "@/types/bdp";
import { BDP_CONSTANTS } from "@/types/bdp";

import { getOrCreateDevice, setDeviceName } from "@/bdp/services/device";
import {
  getAllPairs,
  putPair,
  deletePair as idbDeletePair,
  getPendingConflicts,
  resolveConflict as idbResolveConflict,
  getAllFileEntries,
  deleteFileEntry,
  getAllMerkleNodes,
  deleteMerkleNode,
} from "@/bdp/services/idb";
import { initVault, listVaultFiles } from "@/bdp/services/opfsVault";
import { BDPSession } from "@/bdp/services/session";
import { tryDecodeFrame } from "@/bdp/services/protocol";
import { pullDeltas } from "@/bdp/services/relayClient";
import { applyDeltaEntries } from "@/bdp/services/merkleIndex";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface UseBDPOptions {
  /** From useWebRTCContext — returns the open DataChannel for a peer, or null */
  getDataChannelForPeer: (peerId: string) => RTCDataChannel | null;
  /** From useWebRTCContext — list of peer IDs whose DataChannels are open */
  readyPeers: string[];
}

export interface CreatePairOptions {
  /** Display name for the local folder (shown in the UI) */
  folderName: string;
  /** Real FS handle — only present on Chrome/Edge via showDirectoryPicker() */
  handle?: FileSystemDirectoryHandle | null;
  /** Whether to write-through to the real FS when files are received */
  useRealFS?: boolean;
  direction?: SyncDirection;
  conflictStrategy?: ConflictStrategy;
  /**
   * If provided, reuse this pairId instead of generating a new one.
   * The joiner (receiver) passes the sender's pairId so both sides share
   * the same pair identifier — required for BDP_HELLO matching to succeed.
   */
  pairId?: PairId;
  /** The remote peer's device info — added after QR handshake (optional) */
  peerInfo?: {
    deviceId: DeviceId;
    deviceName: string;
    publicKeyB64: string;
  };
}

export interface UseBDPReturn {
  // ── State ────────────────────────────────────────────────────────────────
  /** The local device record (null until async init resolves) */
  device: BDPDevice | null;
  /** All persisted sync pairs */
  pairs: SyncPair[];
  /** Per-pair engine state, keyed by pairId */
  engineStates: Map<PairId, BDPEngineState>;
  /** Per-pair vault file listings, keyed by pairId */
  vaultFiles: Map<PairId, VaultFileInfo[]>;
  /** Per-pair pending conflicts requiring user action, keyed by pairId */
  pendingConflicts: Map<PairId, BDPConflict[]>;
  /** true while the initial async setup is running */
  initialising: boolean;
  /** Non-null when initialisation failed */
  initError: Error | null;

  // ── Actions ──────────────────────────────────────────────────────────────
  /** Creates a new SyncPair and persists it to IndexedDB */
  createPair(options: CreatePairOptions): Promise<SyncPair>;
  /** Deletes a pair and cleans up its index/merkle data from IDB */
  deletePair(pairId: PairId): Promise<void>;
  /** Manually triggers a sync with any currently connected peer for a pair */
  triggerSync(pairId: PairId): Promise<void>;
  /** Resolves a file conflict and propagates the resolution to the peer */
  resolveConflict(
    pairId: PairId,
    path: string,
    resolution: ConflictResolution,
  ): Promise<void>;
  /** Re-lists vault files for a pair — call after a sync completes */
  refreshVaultFiles(pairId: PairId): Promise<void>;
  /** Updates the device name displayed to peers */
  updateDeviceName(name: string): Promise<void>;

  /**
   * Called by useFileTransfer for every raw DataChannel message.
   * Returns true if the message was a BDP frame (consumed), false otherwise.
   * Non-BDP messages are rejected cheaply via isBDPMessage() before any parse.
   */
  handleFrame(peerId: string, raw: string | ArrayBuffer): boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────────────────────

export function useBDP({
  getDataChannelForPeer,
  readyPeers,
}: UseBDPOptions): UseBDPReturn {
  // ── Core state ────────────────────────────────────────────────────────────
  const [device, setDevice] = useState<BDPDevice | null>(null);
  const [pairs, setPairs] = useState<SyncPair[]>([]);
  const [engineStates, setEngineStates] = useState<Map<PairId, BDPEngineState>>(
    new Map(),
  );
  const [vaultFiles, setVaultFiles] = useState<Map<PairId, VaultFileInfo[]>>(
    new Map(),
  );
  const [pendingConflicts, setPendingConflicts] = useState<
    Map<PairId, BDPConflict[]>
  >(new Map());
  const [initialising, setInitialising] = useState(true);
  const [initError, setInitError] = useState<Error | null>(null);
  /** Incremented on window focus when we have offline pairs — re-runs session matching */
  const [sessionRetryKey, setSessionRetryKey] = useState(0);

  // ── Refs ──────────────────────────────────────────────────────────────────
  /** Active BDPSession instances, keyed by WebRTC peerId */
  const sessionsRef = useRef<Map<string, BDPSession>>(new Map());

  /** Stable snapshot of the previous readyPeers list for diff calculation */
  const prevReadyPeersRef = useRef<string[]>([]);

  /**
   * Stable refs for mutable values consumed inside callbacks.
   * Using refs avoids stale closures without adding pairs/device to
   * useEffect dependency arrays (which would cause thrashing).
   */
  const pairsRef = useRef<SyncPair[]>([]);
  const deviceRef = useRef<BDPDevice | null>(null);

  // Keep refs in sync with state
  useEffect(() => {
    pairsRef.current = pairs;
  }, [pairs]);

  useEffect(() => {
    deviceRef.current = device;
  }, [device]);

  // ── Initialisation ────────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        // Boot the OPFS vault directory structure
        await initVault();

        // Load (or create) the device identity
        const d = await getOrCreateDevice();
        if (cancelled) return;
        setDevice(d);

        // Load persisted pairs
        const savedPairs = await getAllPairs();
        if (cancelled) return;
        setPairs(savedPairs);

        // Load initial vault files for each pair
        const filesMap = new Map<PairId, VaultFileInfo[]>();
        for (const pair of savedPairs) {
          const files = await listVaultFiles(pair.pairId).catch(() => []);
          filesMap.set(pair.pairId, files);
        }
        if (cancelled) return;
        setVaultFiles(filesMap);

        // Load pending conflicts for each pair
        const conflictsMap = new Map<PairId, BDPConflict[]>();
        for (const pair of savedPairs) {
          const records = await getPendingConflicts(pair.pairId).catch(
            () => [],
          );
          // ConflictRecord → BDPConflict (subset of fields)
          const conflicts: BDPConflict[] = records.map((r) => ({
            path: r.path,
            local: r.local,
            remote: r.remote,
            autoResolution: r.autoResolution,
          }));
          conflictsMap.set(pair.pairId, conflicts);
        }
        if (cancelled) return;
        setPendingConflicts(conflictsMap);
      } catch (err) {
        if (!cancelled) {
          setInitError(err instanceof Error ? err : new Error(String(err)));
        }
      } finally {
        if (!cancelled) setInitialising(false);
      }
    }

    void init();
    return () => {
      cancelled = true;
    };
  }, []); // run once on mount

  // ── Relay pull ────────────────────────────────────────────────────────────

  /**
   * Pulls encrypted relay deltas for all pairs and applies them to the local
   * Merkle index. Called on mount and on window focus.
   */
  const pullAllRelayDeltas = useCallback(async () => {
    const currentDevice = deviceRef.current;
    const currentPairs = pairsRef.current;
    if (!currentDevice || currentPairs.length === 0) return;

    for (const pair of currentPairs) {
      try {
        const payloads = await pullDeltas(pair.pairId);
        for (const payload of payloads) {
          if (payload.deltaEntries?.length) {
            await applyDeltaEntries(pair.pairId, payload.deltaEntries);
          }
        }
      } catch (err) {
        // Relay is best-effort — log in dev, silent in prod
        if (import.meta.env.DEV) {
          console.warn(
            `[useBDP] relay pull failed for pair ${pair.pairId}:`,
            err,
          );
        }
      }
    }
  }, []); // stable — reads from refs

  useEffect(() => {
    // Pull immediately after init resolves (pairs may not be loaded yet on
    // first render, but pairs effect will trigger another pull after load)
    void pullAllRelayDeltas();

    const onFocus = () => void pullAllRelayDeltas();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [pullAllRelayDeltas]);

  // Re-pull whenever the pairs list changes (e.g. after createPair)
  useEffect(() => {
    if (pairs.length > 0 && device) {
      void pullAllRelayDeltas();
    }
  }, [pairs, device, pullAllRelayDeltas]);

  // Re-run session matching when user returns to the tab and we have offline pairs
  // (peer may have connected while the tab was in the background)
  useEffect(() => {
    const onFocus = () => {
      if (initialising || pairs.length === 0) return;
      const pairIdsWithSession = new Set(
        [...sessionsRef.current.values()].map((s) => s.pairId),
      );
      const hasPairWithoutSession = pairs.some(
        (p) => !pairIdsWithSession.has(p.pairId),
      );
      if (hasPairWithoutSession) {
        setSessionRetryKey((k) => k + 1);
      }
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [pairs, initialising]);

  // ── Session lifecycle (peer connect / disconnect) ─────────────────────────

  useEffect(() => {
    // Bug #4 fix: if BDP device is still initialising, bail early.
    // This effect will re-run once `initialising` flips to false (it's in
    // the deps array below).  Without this guard, the effect ran with
    // deviceRef.current === null on slow devices (e.g. iPhone first visit
    // where IndexedDB/OPFS init takes longer than the WebRTC handshake),
    // returned early, and never retried — so the BDPSession was never
    // created on the receiver side.
    if (initialising) return;

    const currentDevice = deviceRef.current;
    const currentPairs = pairsRef.current;

    const readyArray = Array.from(readyPeers);

    // ── Track peer arrivals / departures ──────────────────────────────────
    const gonePeers = prevReadyPeersRef.current.filter(
      (id) => !readyArray.includes(id),
    );
    prevReadyPeersRef.current = readyArray;

    // ── Tear down sessions for disconnected peers ──────────────────────────
    for (const peerId of gonePeers) {
      const session = sessionsRef.current.get(peerId);
      if (session) {
        session.stop();
        sessionsRef.current.delete(peerId);

        if (import.meta.env.DEV) {
          console.log(`[useBDP] session stopped for peer ${peerId}`);
        }
      }
    }

    if (!currentDevice) {
      if (import.meta.env.DEV) {
        console.warn(
          `[useBDP] session lifecycle: device not ready yet (initialising=${initialising}), skipping`,
        );
      }
      return;
    }
    if (currentPairs.length === 0) {
      if (import.meta.env.DEV && readyArray.length > 0) {
        console.warn(
          `[useBDP] session lifecycle: ${readyArray.length} ready peer(s) but no pairs yet — create a sync pair first`,
        );
      }
      return;
    }

    // ── Start sessions for any peer+pair combo that still needs one ────────
    //
    // We iterate ALL ready peers (not just "new" ones) so that when a pair
    // is created AFTER the peer has already connected, a session is started
    // immediately on the next render triggered by the `pairs` state change.
    //
    // Matching strategy:
    //   1. Exact match: a pair whose devices list contains the BDP deviceId
    //      equal to the WebRTC peerId (legacy / future explicit mapping).
    //   2. Fallback: most-recently-created pair that has no active session.
    //      Both sides share the same pairId (joiner reuses the initiator's
    //      pairId), so BDP_HELLO greeting will confirm the match and fail
    //      gracefully for any mismatched pair.
    //      Sorting newest-first ensures that if the user has stale/failed
    //      pairs from prior attempts, the brand-new pair is always tried
    //      first (Bug #5 fix).

    // Build the set of pairIds that already have an active session
    const pairsWithSession = new Set(
      [...sessionsRef.current.values()].map((s) => s.pairId),
    );

    for (const peerId of readyArray) {
      // Skip if this peer already has a running session
      if (sessionsRef.current.has(peerId)) continue;

      // 1. Exact device-id match (future-proof once greeting updates devices[])
      let matchingPair = currentPairs.find((p) =>
        p.devices.some((d) => d.deviceId === (peerId as DeviceId)),
      );

      // 2. Bug #5 fix: fallback — most recently created pair without a session
      //    (sorted newest-first so stale leftover pairs are skipped)
      if (!matchingPair) {
        matchingPair = [...currentPairs]
          .sort((a, b) => b.createdAt - a.createdAt)
          .find((p) => !pairsWithSession.has(p.pairId));
      }

      if (!matchingPair) {
        // All pairs already have sessions — this peer is a plain file-transfer
        // peer (no BDP pair), skip it.
        if (import.meta.env.DEV) {
          console.log(
            `[useBDP] peer ${peerId.slice(0, 8)} has no matching pair without a session — skipping (plain file-transfer peer or all pairs claimed)`,
          );
        }
        continue;
      }

      if (import.meta.env.DEV) {
        console.log(
          `[useBDP] matched peer ${peerId.slice(0, 8)} → pair ${matchingPair.pairId.slice(0, 8)} ("${matchingPair.localFolder.name}")`,
        );
      }

      const dc = getDataChannelForPeer(peerId);
      if (!dc || dc.readyState !== "open") {
        if (import.meta.env.DEV) {
          console.warn(
            `[useBDP] DataChannel not open for peer ${peerId.slice(0, 8)} (state=${dc?.readyState ?? "null"}), skipping session — will retry when DataChannel opens`,
          );
        }
        continue;
      }

      // Mark this pair as "claimed" so the next loop iteration doesn't
      // double-assign it to another peer in the same render cycle.
      pairsWithSession.add(matchingPair.pairId);

      const peerInfo = matchingPair.devices.find(
        (d) => d.deviceId !== currentDevice.deviceId,
      );

      const session = new BDPSession({
        pairId: matchingPair.pairId,
        myDeviceId: currentDevice.deviceId,
        peerDeviceId: peerId as DeviceId,
        peerDeviceName: peerInfo?.deviceName ?? "Unknown",
        dataChannel: dc,
        device: currentDevice,
      });

      // Propagate state changes into React state
      const unsubscribeState = session.on("stateChange", (state) => {
        setEngineStates((prev) =>
          new Map(prev).set(matchingPair!.pairId, state),
        );

        // When a sync completes, refresh vault files and conflicts
        if (state.phase === "idle" || state.phase === "finalizing") {
          void refreshVaultFilesInternal(matchingPair!.pairId);
          void refreshConflictsInternal(matchingPair!.pairId);
        }
      });

      // Bug #3 fix: update pair.devices once the peer's identity is confirmed
      // via the BDP_HELLO exchange so the pair card shows the real peer name
      // instead of "Waiting for peer…" forever.
      const unsubscribePeerIdentified = session.on(
        "peerIdentified",
        ({ deviceId, deviceName, publicKeyB64 }) => {
          const pairId = matchingPair!.pairId;

          setPairs((prev) => {
            const idx = prev.findIndex((p) => p.pairId === pairId);
            if (idx === -1) return prev;

            const existing = prev[idx]!;
            // Skip if this device is already in the list
            const alreadyKnown = existing.devices.some(
              (d) => d.deviceId === deviceId,
            );
            if (alreadyKnown) return prev;

            const updated: typeof existing = {
              ...existing,
              devices: [
                ...existing.devices,
                {
                  deviceId,
                  deviceName,
                  publicKeyB64,
                  lastSeenAt: Date.now(),
                },
              ],
            };

            // Persist asynchronously — don't block state update
            void putPair(updated);

            const next = [...prev];
            next[idx] = updated;
            return next;
          });
        },
      );

      // Clean up listeners when the session stops
      session.on("stopped", () => {
        unsubscribeState();
        unsubscribePeerIdentified();

        // Bug #6 fix: remove the session from sessionsRef when it stops so
        // that a new session can be attempted for the same peer if the
        // session failed (e.g. start() threw, DataChannel closed mid-greeting,
        // or a transient error caused a retry loop to exhaust).
        // Without this, sessionsRef.current.has(peerId) stays true forever
        // for an errored session, blocking any recovery while the peer is
        // still connected.
        sessionsRef.current.delete(peerId);

        if (import.meta.env.DEV) {
          console.log(
            `[useBDP] session removed from sessionsRef on stop for peer ${peerId}`,
          );
        }
      });

      sessionsRef.current.set(peerId, session);

      if (import.meta.env.DEV) {
        console.log(
          `[useBDP] 🚀 starting BDP session — peer=${peerId.slice(0, 8)} pair=${matchingPair.pairId.slice(0, 8)} dc=${dc.readyState}`,
        );
      }

      session.start().catch((err) => {
        if (import.meta.env.DEV) {
          console.error(
            `[useBDP] ❌ session.start() failed for peer ${peerId.slice(0, 8)}:`,
            err,
          );
        }
        // If start() itself threw (e.g. DataChannel was already closed),
        // remove the session immediately so the effect can retry on the next
        // readyPeers / pairs update.
        sessionsRef.current.delete(peerId);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readyPeers, pairs, getDataChannelForPeer, initialising, sessionRetryKey]);
  // `pairs` is in deps so that creating a pair while a peer is already
  // connected immediately triggers a session start.
  // `sessionRetryKey` is bumped on window focus when we have offline pairs,
  // so we re-run session matching (peer may have connected in the background).
  // `device` is read from a ref to avoid stale closures.
  // `initialising` is in deps (Bug #4 fix) so that when IDB/OPFS init
  // completes on slow devices (e.g. iPhone first visit), the effect re-runs
  // and creates BDPSessions for any peers that connected while device was null.

  // ── Internal helpers ──────────────────────────────────────────────────────

  const refreshVaultFilesInternal = useCallback(
    async (pairId: PairId): Promise<void> => {
      try {
        const files = await listVaultFiles(pairId);
        setVaultFiles((prev) => new Map(prev).set(pairId, files));
      } catch (err) {
        if (import.meta.env.DEV) {
          console.warn(`[useBDP] vault refresh failed for ${pairId}:`, err);
        }
      }
    },
    [],
  );

  const refreshConflictsInternal = useCallback(
    async (pairId: PairId): Promise<void> => {
      try {
        const records = await getPendingConflicts(pairId);
        const conflicts: BDPConflict[] = records.map((r) => ({
          path: r.path,
          local: r.local,
          remote: r.remote,
          autoResolution: r.autoResolution,
        }));
        setPendingConflicts((prev) => new Map(prev).set(pairId, conflicts));
      } catch (err) {
        if (import.meta.env.DEV) {
          console.warn(`[useBDP] conflict refresh failed for ${pairId}:`, err);
        }
      }
    },
    [],
  );

  // ── Public actions ────────────────────────────────────────────────────────

  /**
   * Decodes a raw DataChannel message and dispatches it to the matching session.
   * Returns true if the message was a BDP frame (consumed), false if it is not
   * a BDP message and should be passed to the legacy protocol handler.
   */
  const handleFrame = useCallback(
    (peerId: string, raw: string | ArrayBuffer): boolean => {
      const result = tryDecodeFrame(raw);
      if (!result) return false; // not a BDP message — let legacy handler process it

      const session = sessionsRef.current.get(peerId);
      if (!session) {
        if (import.meta.env.DEV) {
          console.warn(
            `[useBDP] received BDP frame from unknown peer ${peerId}`,
          );
        }
        // Still consumed — we recognised it as BDP, just no session yet
        return true;
      }

      session.handleFrame(result.frame, result.chunkData);
      return true;
    },
    [],
  );

  /**
   * Creates a new SyncPair, persists it to IDB, and updates React state.
   */
  const createPair = useCallback(
    async (options: CreatePairOptions): Promise<SyncPair> => {
      const currentDevice = deviceRef.current;
      if (!currentDevice) {
        throw new Error("BDP device not initialised yet — retry in a moment");
      }

      // Reuse the provided pairId (joiner uses sender's pairId) or generate a new one
      const pairId = options.pairId ?? (nanoid(32) as PairId);

      const devices: SyncPair["devices"] = [
        {
          deviceId: currentDevice.deviceId,
          deviceName: currentDevice.deviceName,
          publicKeyB64: currentDevice.publicKeyB64,
          lastSeenAt: Date.now(),
        },
      ];

      // If caller already has the peer's identity (post-QR handshake), add it
      if (options.peerInfo) {
        devices.push({
          deviceId: options.peerInfo.deviceId,
          deviceName: options.peerInfo.deviceName,
          publicKeyB64: options.peerInfo.publicKeyB64,
          lastSeenAt: null,
        });
      }

      const pair: SyncPair = {
        pairId,
        devices,
        localFolder: {
          name: options.folderName,
          handle: options.handle ?? null,
          opfsPath: `${BDP_CONSTANTS.OPFS_VAULT}/${pairId}`,
          useRealFS: options.useRealFS ?? false,
        },
        direction: options.direction ?? "bidirectional",
        conflictStrategy: options.conflictStrategy ?? "last-write-wins",
        includePatterns: [],
        excludePatterns: [],
        maxFileSizeBytes: 500 * 1024 * 1024, // 500 MB default
        createdAt: Date.now(),
        lastSyncedAt: null,
        lastRelayFetchedAt: null,
        localMerkleRoot: null,
        knownRemoteRoots: {},
      };

      await putPair(pair);

      setPairs((prev) => [...prev, pair]);
      setVaultFiles((prev) => new Map(prev).set(pairId, []));
      setPendingConflicts((prev) => new Map(prev).set(pairId, []));

      if (import.meta.env.DEV) {
        console.log(
          `[useBDP] created pair ${pairId} ("${options.folderName}")`,
        );
      }

      return pair;
    },
    [],
  );

  /**
   * Deletes a SyncPair and cascades cleanup of its IDB index/merkle data.
   * Does NOT delete OPFS vault files — the user retains their data.
   */
  const deletePair = useCallback(async (pairId: PairId): Promise<void> => {
    // Stop any active session for this pair
    for (const [peerId, session] of sessionsRef.current.entries()) {
      if (session.pairId === pairId) {
        session.stop();
        sessionsRef.current.delete(peerId);
      }
    }

    // Cascade delete file index entries for this pair
    try {
      const entries = await getAllFileEntries(pairId);
      for (const entry of entries) {
        await deleteFileEntry(pairId, entry.path);
      }
    } catch (err) {
      if (import.meta.env.DEV) {
        console.warn(`[useBDP] cascade delete fileIndex failed:`, err);
      }
    }

    // Cascade delete merkle nodes for this pair
    try {
      const nodes = await getAllMerkleNodes(pairId);
      for (const node of nodes) {
        await deleteMerkleNode(pairId, node.nodePath);
      }
    } catch (err) {
      if (import.meta.env.DEV) {
        console.warn(`[useBDP] cascade delete merkleNodes failed:`, err);
      }
    }

    // Delete the pair record itself
    await idbDeletePair(pairId);

    // Update React state
    setPairs((prev) => prev.filter((p) => p.pairId !== pairId));
    setEngineStates((prev) => {
      const next = new Map(prev);
      next.delete(pairId);
      return next;
    });
    setVaultFiles((prev) => {
      const next = new Map(prev);
      next.delete(pairId);
      return next;
    });
    setPendingConflicts((prev) => {
      const next = new Map(prev);
      next.delete(pairId);
      return next;
    });

    if (import.meta.env.DEV) {
      console.log(`[useBDP] deleted pair ${pairId}`);
    }
  }, []);

  /**
   * Manually triggers a sync for a pair by restarting its active session.
   * No-op if no peer is currently connected for this pair.
   */
  const triggerSync = useCallback(async (pairId: PairId): Promise<void> => {
    for (const [, session] of sessionsRef.current.entries()) {
      if (session.pairId === pairId && !session.stopped) {
        // Session is already running — re-run the hello phase to kick off a sync
        await session.start().catch((err) => {
          if (import.meta.env.DEV) {
            console.warn(`[useBDP] triggerSync failed for ${pairId}:`, err);
          }
        });
        return;
      }
    }

    if (import.meta.env.DEV) {
      console.info(
        `[useBDP] triggerSync: no active session for pair ${pairId}`,
      );
    }
  }, []);

  /**
   * Resolves a conflict by delegating to the active BDPSession, which sends
   * the resolution to the peer and applies it locally. Also updates IDB and
   * React state.
   */
  const resolveConflict = useCallback(
    async (
      pairId: PairId,
      path: string,
      resolution: ConflictResolution,
    ): Promise<void> => {
      // Delegate to the active session (handles peer notification)
      for (const [, session] of sessionsRef.current.entries()) {
        if (session.pairId === pairId && !session.stopped) {
          await session.resolveConflict(path, resolution);
          break;
        }
      }

      // Persist the resolution to IDB regardless of session state
      await idbResolveConflict(pairId, path, resolution).catch((err) => {
        if (import.meta.env.DEV) {
          console.warn(`[useBDP] idbResolveConflict failed:`, err);
        }
      });

      // Remove the resolved conflict from React state
      setPendingConflicts((prev) => {
        const current = prev.get(pairId) ?? [];
        const updated = current.filter((c) => c.path !== path);
        return new Map(prev).set(pairId, updated);
      });
    },
    [],
  );

  /**
   * Re-lists vault files for a pair. Call this after a sync completes or
   * after the user exports/modifies files in the vault.
   */
  const refreshVaultFiles = useCallback(
    async (pairId: PairId): Promise<void> => {
      await refreshVaultFilesInternal(pairId);
    },
    [refreshVaultFilesInternal],
  );

  /**
   * Updates the device's display name (shown to peers during sync).
   */
  const updateDeviceName = useCallback(async (name: string): Promise<void> => {
    await setDeviceName(name);
    const updated = await getOrCreateDevice();
    setDevice(updated);
  }, []);

  // ── Cleanup on unmount ────────────────────────────────────────────────────

  useEffect(() => {
    const sessions = sessionsRef.current;
    return () => {
      // Stop all active sessions when the hook unmounts
      for (const session of sessions.values()) {
        session.stop();
      }
      sessions.clear();
    };
  }, []);

  // ── Stable return value ───────────────────────────────────────────────────

  return useMemo(
    () => ({
      device,
      pairs,
      engineStates,
      vaultFiles,
      pendingConflicts,
      initialising,
      initError,
      createPair,
      deletePair,
      triggerSync,
      resolveConflict,
      refreshVaultFiles,
      updateDeviceName,
      handleFrame,
    }),
    [
      device,
      pairs,
      engineStates,
      vaultFiles,
      pendingConflicts,
      initialising,
      initError,
      createPair,
      deletePair,
      triggerSync,
      resolveConflict,
      refreshVaultFiles,
      updateDeviceName,
      handleFrame,
    ],
  );
}
