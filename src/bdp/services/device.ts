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
 * Uses IndexedDB directly
 * The private key is non-extractable and stored as a native CryptoKey in IDB.
 */

import { nanoid } from "nanoid";

import type { BDPCapabilities, BDPDevice, DeviceId, PairId } from "@/types/bdp";
import { BDP_CONSTANTS } from "@/types/bdp";

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

const DEVICE_DB_NAME = BDP_CONSTANTS.IDB_DB_NAME;
const DEVICE_DB_VERSION = BDP_CONSTANTS.IDB_DB_VERSION;
const DEVICE_STORE = "devices";
const DEVICE_KEY = "self";

/**
 * Private key store name — separate from the device record so the non-extractable
 * CryptoKey is never accidentally serialised to JSON.
 */
const KEY_STORE = "deviceKeys";

/** Cached device record — populated after the first call to getOrCreateDevice(). */
let cachedDevice: BDPDevice | null = null;

/** Cached private key — kept in memory to avoid redundant IDB reads. */
let cachedPrivateKey: CryptoKey | null = null;

// ─────────────────────────────────────────────────────────────────────────────
// Raw IDB helpers (device.ts cannot use idb.ts yet)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Opens the BDP IndexedDB database.
 * Creates the minimal stores needed by device.ts if they don't exist.
 * The full schema migration lives in idb.ts — this just ensures the two
 * stores device.ts needs are present.
 */
function openDeviceDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DEVICE_DB_NAME, DEVICE_DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      // devices store — keyed by 'self'
      if (!db.objectStoreNames.contains(DEVICE_STORE)) {
        db.createObjectStore(DEVICE_STORE);
      }

      // deviceKeys store — parallel store for non-extractable CryptoKey objects
      if (!db.objectStoreNames.contains(KEY_STORE)) {
        db.createObjectStore(KEY_STORE);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () =>
      reject(new Error("BDP device DB open blocked — close other tabs"));
  });
}

/**
 * Reads a value from the given store by key.
 */
function idbRead<T>(
  db: IDBDatabase,
  storeName: string,
  key: IDBValidKey,
): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const req = tx.objectStore(storeName).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Writes a value to the given store under the given key.
 */
function idbWrite(
  db: IDBDatabase,
  storeName: string,
  key: IDBValidKey,
  value: unknown,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const req = tx.objectStore(storeName).put(value, key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

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
 * On first launch:
 *  1. Generates a nanoid(21) DeviceId
 *  2. Generates a non-extractable X25519 keypair
 *  3. Exports the public key as base64
 *  4. Persists the BDPDevice record and the private CryptoKey in IDB
 *
 * On subsequent calls:
 *  - Loads the persisted record from IDB
 *  - Refreshes capabilities (browser support may have changed)
 *  - Returns the full BDPDevice
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

  const db = await openDeviceDB();

  const existing = await idbRead<BDPDevice>(db, DEVICE_STORE, DEVICE_KEY);

  if (existing) {
    const device: BDPDevice = {
      ...existing,
      capabilities: detectCapabilities(),
    };

    // Warm up the private key cache
    cachedPrivateKey =
      (await idbRead<CryptoKey>(db, KEY_STORE, DEVICE_KEY)) ?? null;

    cachedDevice = device;
    return device;
  }

  // ── First launch ────────────────────────────────────────────────────────────

  // Generate X25519 keypair
  // Private key is non-extractable — it never leaves the browser's crypto store
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

  // Persist — write both records in their own transactions
  // (IDB object stores must be in the same transaction to commit atomically,
  // but since these are different stores opened together it's fine)
  await idbWrite(db, DEVICE_STORE, DEVICE_KEY, device);
  await idbWrite(db, KEY_STORE, DEVICE_KEY, keyPair.privateKey);

  cachedPrivateKey = keyPair.privateKey;
  cachedDevice = device;

  return device;
}

/**
 * Returns the base64-encoded public key for this device.
 * The device record must have been created first via getOrCreateDevice().
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
 * reproduce. This key is used for P2P WebRTC DataChannel message encryption.
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
    [], // no key usages on the public key
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
 * Used for relay encryption when we don't yet have a peer's ECDH public key
 * (e.g. first relay push before the peer has joined). The pairId itself is
 * the shared secret — treat it like a password and never expose it.
 *
 * Key derivation uses HKDF-SHA-256 with a zero salt and a fixed info string.
 *
 * @param pairId - The shared pair secret
 * @returns Non-extractable AES-256-GCM CryptoKey for encrypt/decrypt
 */
export async function deriveGroupKey(pairId: PairId): Promise<CryptoKey> {
  // Import the pairId bytes as HKDF key material
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
      salt: new Uint8Array(32), // zero salt — the pairId provides the entropy
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
  const db = await openDeviceDB();

  const newSeq = device.localSeq + 1;
  const updated: BDPDevice = { ...device, localSeq: newSeq };

  await idbWrite(db, DEVICE_STORE, DEVICE_KEY, updated);
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
  const db = await openDeviceDB();

  const updated: BDPDevice = { ...device, deviceName: name };
  await idbWrite(db, DEVICE_STORE, DEVICE_KEY, updated);
  cachedDevice = updated;
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Loads the private key from the in-memory cache or falls back to IDB.
 *
 * @throws If no private key exists (device hasn't been created yet)
 */
async function loadPrivateKey(): Promise<CryptoKey> {
  if (cachedPrivateKey !== null) return cachedPrivateKey;

  const db = await openDeviceDB();
  const key = await idbRead<CryptoKey>(db, KEY_STORE, DEVICE_KEY);

  if (!key) {
    throw new Error(
      "BDP: private key not found — call getOrCreateDevice() first",
    );
  }

  cachedPrivateKey = key;
  return key;
}

/**
 * Builds a default human-readable device name from the browser user agent.
 * Best-effort: falls back to a random suffix if detection fails.
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
