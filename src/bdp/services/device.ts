/**
 * BDP — Device Identity Service (A1)
 *
 * Responsible for:
 *  - Generating and persisting a unique DeviceId + X25519 keypair on first launch
 *  - Loading the existing device record on subsequent launches
 *  - Deriving ECDH shared keys with peers (used for P2P encryption)
 *  - Deriving a group key from pairId (used for relay encryption)
 *  - Detecting browser capabilities
 *
 * All persistence goes through idb.ts so the full 10-store schema is always
 * created in a single onupgradeneeded call — no schema-race where device.ts
 * used to open the same DB first with only 2 stores, leaving 8 stores missing.
 *
 * Cold-start lookup strategy:
 *   The 'devices' store uses keyPath:'deviceId', so records are keyed by their
 *   own deviceId. Since there is always exactly one self-device record, we use
 *   idbGetAll('devices') on a cold start to retrieve it without needing to know
 *   the deviceId first. After the first call the record is held in memory.
 */

import { nanoid } from "nanoid";

import type { BDPCapabilities, BDPDevice, DeviceId, PairId } from "@/types/bdp";
import { BDP_CONSTANTS } from "@/types/bdp";
import { openDB, idbGetAll, idbPut, idbGet, idbPutWithKey } from "./idb";

// ─────────────────────────────────────────────────────────────────────────────
// In-memory caches
// ─────────────────────────────────────────────────────────────────────────────

/** Cached device record — populated after the first call to getOrCreateDevice(). */
let cachedDevice: BDPDevice | null = null;

/** Cached private key — kept in memory to avoid redundant IDB reads. */
let cachedPrivateKey: CryptoKey | null = null;

// ─────────────────────────────────────────────────────────────────────────────
// Capability detection
// ─────────────────────────────────────────────────────────────────────────────

/** Result is computed once and cached — capabilities don't change at runtime. */
let cachedCompressionAlgos: ReadonlyArray<
  "deflate-raw" | "gzip" | "deflate"
> | null = null;

/**
 * Detects which CompressionStream algorithms the current browser supports.
 * Probes each algorithm by attempting to instantiate a CompressionStream.
 */
function detectCompressionAlgos(): ReadonlyArray<
  "deflate-raw" | "gzip" | "deflate"
> {
  if (cachedCompressionAlgos !== null) return cachedCompressionAlgos;

  const candidates: Array<"deflate-raw" | "gzip" | "deflate"> = [
    "deflate-raw",
    "gzip",
    "deflate",
  ];

  const supported: Array<"deflate-raw" | "gzip" | "deflate"> = [];

  for (const algo of candidates) {
    try {
      // CompressionStream throws a TypeError for unsupported formats
      new CompressionStream(algo);
      supported.push(algo);
    } catch {
      // algorithm not supported — skip
    }
  }

  cachedCompressionAlgos = supported;
  return supported;
}

/**
 * Detects current browser capabilities.
 * Called on every app launch so the record stays fresh.
 *
 * @returns Current BDPCapabilities snapshot
 */
export function detectCapabilities(): BDPCapabilities {
  return {
    hasFSAPI: "showDirectoryPicker" in window,
    hasOPFS: "storage" in navigator && "getDirectory" in navigator.storage,
    canWriteRealFS: "showDirectoryPicker" in window,
    hasBackgroundSync: "serviceWorker" in navigator && "SyncManager" in window,
    hasFileObserver: "FileSystemObserver" in window,
    compressionAlgos: detectCompressionAlgos(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns the persisted device record, creating it on first call.
 *
 * Uses idb.ts's openDB() so the full 10-store schema is always initialised
 * before any reads or writes — no partial-schema races possible.
 *
 * On first launch:
 *  1. Generates a nanoid(21) DeviceId
 *  2. Generates a non-extractable X25519 keypair
 *  3. Exports the public key as base64
 *  4. Persists the BDPDevice record in 'devices' and the private CryptoKey
 *     in 'deviceKeys' (keyed by deviceId) via idb.ts helpers
 *
 * On subsequent calls:
 *  - Returns from in-memory cache (capabilities refreshed each time)
 *  - Falls back to IDB on cold start via idbGetAll('devices')[0]
 *
 * @returns The device record for this browser
 * @throws If IndexedDB or WebCrypto are unavailable
 */
export async function getOrCreateDevice(): Promise<BDPDevice> {
  if (cachedDevice !== null) {
    // Refresh capabilities on every call — they're cheap to re-detect
    cachedDevice = { ...cachedDevice, capabilities: detectCapabilities() };
    return cachedDevice;
  }

  // Ensure the full schema exists before touching any store
  await openDB();

  // Cold-start: the 'devices' store is keyed by deviceId, so we use getAll()
  // to retrieve the self-record without needing to know the deviceId first.
  // There is always at most one self-device record in this store.
  const allDevices = await idbGetAll<BDPDevice>("devices");
  const existing = allDevices[0] as BDPDevice | undefined;

  if (existing) {
    const device: BDPDevice = {
      ...existing,
      capabilities: detectCapabilities(),
    };

    // Warm up the private key cache
    cachedPrivateKey =
      (await idbGet<CryptoKey>("deviceKeys", existing.deviceId)) ?? null;

    cachedDevice = device;
    return device;
  }

  // ── First launch ────────────────────────────────────────────────────────────

  // Generate X25519 keypair.
  // Private key is non-extractable — it never leaves the browser's crypto store.
  const keyPair = (await crypto.subtle.generateKey(
    { name: "X25519" },
    false, // private key is non-extractable
    ["deriveKey"],
  )) as CryptoKeyPair;

  // Export the public key as raw bytes → base64
  const rawPub = await crypto.subtle.exportKey("raw", keyPair.publicKey);
  const publicKeyB64 = btoa(String.fromCharCode(...new Uint8Array(rawPub)));

  const deviceId = nanoid(21) as DeviceId;
  const deviceName = buildDefaultDeviceName();

  const device: BDPDevice = {
    deviceId,
    deviceName,
    localSeq: 0,
    publicKeyB64,
    capabilities: detectCapabilities(),
    createdAt: Date.now(),
  };

  // Persist the device record.
  // 'devices' uses keyPath:'deviceId' — idbPut uses device.deviceId as the key.
  await idbPut<BDPDevice>("devices", device);

  // Persist the private key.
  // 'deviceKeys' uses keyPath:null — idbPutWithKey stores under explicit key.
  await idbPutWithKey("deviceKeys", deviceId, keyPair.privateKey);

  cachedPrivateKey = keyPair.privateKey;
  cachedDevice = device;

  return device;
}

/**
 * Returns the base64-encoded public key for this device.
 *
 * @returns Base64 public key string
 * @throws If device hasn't been initialised yet
 */
export async function getPublicKeyB64(): Promise<string> {
  const device = await getOrCreateDevice();
  return device.publicKeyB64;
}

/**
 * Derives an ECDH shared AES-256-GCM key with a remote peer.
 *
 * Uses our non-extractable X25519 private key and the peer's exported public
 * key (base64) to derive a symmetric key that only these two devices can
 * reproduce. Used for P2P WebRTC DataChannel message encryption.
 *
 * @param theirPublicKeyB64 - The peer's base64-encoded X25519 public key
 * @returns Non-extractable AES-256-GCM CryptoKey for encrypt/decrypt
 * @throws If the peer's public key is malformed or ECDH derivation fails
 */
export async function deriveECDHSharedKey(
  theirPublicKeyB64: string,
): Promise<CryptoKey> {
  const privateKey = await loadPrivateKey();

  // Decode their public key from base64
  const rawBytes = Uint8Array.from(atob(theirPublicKeyB64), (c) =>
    c.charCodeAt(0),
  );

  const theirPublicKey = await crypto.subtle.importKey(
    "raw",
    rawBytes,
    { name: "X25519" },
    false, // not extractable
    [], // no key usages on the public key itself
  );

  // Derive a symmetric AES-256-GCM key from the ECDH exchange
  return crypto.subtle.deriveKey(
    { name: "X25519", public: theirPublicKey },
    privateKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/**
 * Derives a deterministic AES-256-GCM group key from a pairId.
 *
 * Used for relay encryption when we don't yet have a peer's ECDH public key.
 * The pairId is the shared secret — never expose it.
 *
 * Key derivation: HKDF-SHA-256, zero salt, fixed info string.
 *
 * @param pairId - The shared pair secret
 * @returns Non-extractable AES-256-GCM CryptoKey for encrypt/decrypt
 */
export async function deriveGroupKey(pairId: PairId): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pairId),
    "HKDF",
    false,
    ["deriveKey"],
  );

  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(32), // zero salt — pairId provides the entropy
      info: new TextEncoder().encode(BDP_CONSTANTS.HKDF_INFO),
    },
    keyMaterial,
    { name: "AES-GCM", length: BDP_CONSTANTS.AES_KEY_BITS },
    false,
    ["encrypt", "decrypt"],
  );
}

/**
 * Increments localSeq and persists the updated device record.
 *
 * Must be called every time a local file change is recorded in the index.
 * The returned seq is used as the 'seq' field on BDPFileEntry.
 *
 * @returns The new (incremented) localSeq value
 */
export async function incrementLocalSeq(): Promise<number> {
  const device = await getOrCreateDevice();

  const newSeq = device.localSeq + 1;
  const updated: BDPDevice = { ...device, localSeq: newSeq };

  await idbPut<BDPDevice>("devices", updated);
  cachedDevice = updated;

  return newSeq;
}

/**
 * Updates the device's human-readable name.
 *
 * @param name - New display name (shown to peers during sync)
 */
export async function setDeviceName(name: string): Promise<void> {
  const device = await getOrCreateDevice();

  const updated: BDPDevice = { ...device, deviceName: name };
  await idbPut<BDPDevice>("devices", updated);
  cachedDevice = updated;
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Loads the private key from the in-memory cache or falls back to IDB.
 * Requires getOrCreateDevice() to have been called first so cachedDevice
 * is populated (needed to know which deviceId to look up).
 *
 * @throws If the device hasn't been loaded or the key is missing from IDB
 */
async function loadPrivateKey(): Promise<CryptoKey> {
  if (cachedPrivateKey !== null) return cachedPrivateKey;

  if (!cachedDevice) {
    throw new Error(
      "BDP: loadPrivateKey called before getOrCreateDevice() — initialise the device first",
    );
  }

  const key = await idbGet<CryptoKey>("deviceKeys", cachedDevice.deviceId);

  if (!key) {
    throw new Error(
      "BDP: private key not found in IDB — storage may have been cleared",
    );
  }

  cachedPrivateKey = key;
  return key;
}

/**
 * Builds a default human-readable device name from the browser user agent.
 * Best-effort: falls back to a generic label if detection fails.
 *
 * Examples: "chrome-linux", "safari-macos", "firefox-windows"
 */
function buildDefaultDeviceName(): string {
  const ua = navigator.userAgent.toLowerCase();

  let browser = "browser";
  if (ua.includes("firefox")) browser = "firefox";
  else if (ua.includes("edg/")) browser = "edge";
  else if (ua.includes("chrome")) browser = "chrome";
  else if (ua.includes("safari")) browser = "safari";

  let os = "device";
  if (ua.includes("windows")) os = "windows";
  else if (ua.includes("mac os")) os = "macos";
  else if (ua.includes("linux")) os = "linux";
  else if (ua.includes("android")) os = "android";
  else if (ua.includes("iphone") || ua.includes("ipad")) os = "ios";

  return `${browser}-${os}`;
}
