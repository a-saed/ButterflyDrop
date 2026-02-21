/**
 * BDP — Protocol Codec (B1)
 *
 * Encodes and decodes BDP frames for the WebRTC DataChannel.
 *
 * Two wire formats:
 *
 *   Control frames (all types except BDP_CHUNK):
 *     Plain UTF-8 JSON text — sent as a string over the DataChannel.
 *     Fast path: the DataChannel string API avoids any extra allocation.
 *
 *   Data frames (BDP_CHUNK only):
 *     Binary ArrayBuffer with the layout:
 *       [headerLen: u16 big-endian]  — 2 bytes
 *       [header: JSON UTF-8 bytes]   — headerLen bytes
 *       [chunk: raw bytes]           — remainder
 *     This avoids base64 overhead on large binary payloads.
 *
 * Fast discrimination:
 *   isBDPMessage()  — cheap peek before any allocation or full parse
 *   isBDPFrame()    — full structural validation (from types/bdp.ts)
 *
 * Dependencies: src/types/bdp.ts, nanoid
 */

import { nanoid } from "nanoid";

import type {
  BDPChunkFrame,
  BDPFrame,
  DeviceId,
  MsgId,
  PairId,
  TransferId,
} from "@/types/bdp";
import { isBDPFrame } from "@/types/bdp";

// ─────────────────────────────────────────────────────────────────────────────
// ID generators
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generates a unique message ID for a BDP frame header.
 * Uses nanoid(21) — URL-safe, collision-resistant.
 *
 * @returns A new MsgId
 */
export function makeMsgId(): MsgId {
  return nanoid(21) as MsgId;
}

/**
 * Generates a unique transfer ID for a file transfer session.
 * Uses nanoid(21) — URL-safe, collision-resistant.
 *
 * @returns A new TransferId
 */
export function makeTransferId(): TransferId {
  return nanoid(21) as TransferId;
}

// ─────────────────────────────────────────────────────────────────────────────
// Encoding
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Encodes any non-chunk BDP frame as a JSON string for DataChannel text send.
 *
 * All control frames (HELLO, MERKLE, INDEX_REQUEST, INDEX_RESPONSE,
 * CHUNK_REQUEST, ACK, CONFLICT, CONFLICT_RESOLUTION, DONE, ERROR,
 * PING, PONG) use this path.
 *
 * @param frame - Any BDP frame except BDPChunkFrame
 * @returns UTF-8 JSON string ready to pass to dataChannel.send()
 */
export function encodeControlFrame(
  frame: Exclude<BDPFrame, BDPChunkFrame>,
): string {
  return JSON.stringify(frame);
}

/**
 * Encodes a BDP_CHUNK frame together with its raw chunk bytes into a single
 * ArrayBuffer using the binary wire format:
 *
 *   [headerLen: u16 big-endian][header: JSON bytes][chunk: raw bytes]
 *
 * The header JSON contains all frame metadata (transferId, chunkHash, etc.).
 * The chunk bytes follow immediately after — no base64, no extra copies.
 *
 * @param frame - The BDPChunkFrame (without the ArrayBuffer data field)
 * @param chunkData - Raw chunk bytes (may be compressed by the CAS layer)
 * @returns Binary frame ready to pass to dataChannel.send()
 * @throws RangeError if the header JSON exceeds 65535 bytes (u16 max)
 */
export function encodeChunkFrame(
  frame: BDPChunkFrame,
  chunkData: ArrayBuffer,
): ArrayBuffer {
  const headerJSON = JSON.stringify(frame);
  const headerBytes = new TextEncoder().encode(headerJSON);
  const headerLen = headerBytes.byteLength;

  if (headerLen > 0xffff) {
    throw new RangeError(
      `BDP: chunk frame header too large (${headerLen} bytes, max 65535)`,
    );
  }

  // Layout: 2-byte header length + header bytes + chunk bytes
  const buf = new ArrayBuffer(2 + headerLen + chunkData.byteLength);
  const view = new DataView(buf);

  // Write header length as big-endian u16
  view.setUint16(0, headerLen, false);

  // Write header bytes
  new Uint8Array(buf, 2, headerLen).set(headerBytes);

  // Write chunk bytes
  new Uint8Array(buf, 2 + headerLen).set(new Uint8Array(chunkData));

  return buf;
}

// ─────────────────────────────────────────────────────────────────────────────
// Decoding
// ─────────────────────────────────────────────────────────────────────────────

/** Result of decoding a raw DataChannel message. */
export interface DecodeResult {
  frame: BDPFrame;
  /** Present only for BDP_CHUNK frames — the raw chunk bytes. */
  chunkData?: ArrayBuffer;
}

/**
 * Decodes a raw DataChannel message into a typed BDP frame.
 *
 * Dispatch logic:
 *   - string  → JSON.parse() → control frame
 *   - ArrayBuffer → binary decode → BDP_CHUNK + chunkData
 *
 * Callers should call isBDPMessage() first for a cheap fast-reject before
 * calling this function, to avoid parsing non-BDP messages.
 *
 * @param raw - The raw DataChannel message (string or ArrayBuffer)
 * @returns Typed frame and optional chunk data
 * @throws SyntaxError if the JSON is malformed
 * @throws TypeError if the decoded value is not a valid BDP frame
 */
export function decodeFrame(raw: string | ArrayBuffer): DecodeResult {
  if (typeof raw === "string") {
    const parsed: unknown = JSON.parse(raw);

    if (!isBDPFrame(parsed)) {
      throw new TypeError(
        "BDP: decoded string message is not a valid BDP frame",
      );
    }

    return { frame: parsed };
  }

  // Binary — decode as [headerLen u16][header JSON][chunk bytes]
  if (raw.byteLength < 4) {
    throw new RangeError(
      `BDP: binary message too short (${raw.byteLength} bytes)`,
    );
  }

  const view = new DataView(raw);
  const headerLen = view.getUint16(0, false); // big-endian

  if (headerLen === 0 || 2 + headerLen > raw.byteLength) {
    throw new RangeError(
      `BDP: invalid header length ${headerLen} in binary frame (total ${raw.byteLength} bytes)`,
    );
  }

  const headerBytes = new Uint8Array(raw, 2, headerLen);
  const headerJSON = new TextDecoder().decode(headerBytes);
  const parsed: unknown = JSON.parse(headerJSON);

  if (!isBDPFrame(parsed)) {
    throw new TypeError(
      "BDP: decoded binary frame header is not a valid BDP frame",
    );
  }

  if (parsed.type !== "BDP_CHUNK") {
    throw new TypeError(
      `BDP: binary frame has unexpected type '${parsed.type}' (only BDP_CHUNK is binary)`,
    );
  }

  const chunkData = raw.slice(2 + headerLen);
  return { frame: parsed, chunkData };
}

// ─────────────────────────────────────────────────────────────────────────────
// Fast type guard
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fast pre-check that a raw DataChannel message is a BDP frame.
 *
 * This is a cheap string-peek / size-check to avoid allocating a full JSON
 * parse on non-BDP messages (e.g. legacy file transfer messages).
 *
 * Must be called BEFORE decodeFrame() in any message handler.
 *
 * For strings: looks for the '"cp":true' discriminant without full JSON parse.
 * For ArrayBuffers: accepts any buffer >4 bytes (binary BDP frames always have
 * a 2-byte length prefix + at least 2 bytes of header).
 *
 * This is intentionally permissive — decodeFrame() will reject malformed
 * messages with a proper error. This function is only a fast-reject path.
 *
 * @param raw - Raw DataChannel message
 * @returns true if this looks like a BDP message; false to discard immediately
 */
export function isBDPMessage(raw: string | ArrayBuffer): boolean {
  if (typeof raw === "string") {
    // Peek for the 'cp' discriminant without parsing the full JSON.
    // JSON.stringify always produces either '"cp":true' or '"cp": true'.
    return raw.includes('"cp":true') || raw.includes('"cp": true');
  }

  // Binary frames: any ArrayBuffer larger than 4 bytes could be a BDP_CHUNK.
  // (2-byte header length + at least 2 bytes of JSON header minimum)
  return raw.byteLength > 4;
}

// ─────────────────────────────────────────────────────────────────────────────
// Frame builder helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Builds the common BDP frame header fields.
 * Used internally by session.ts frame builder methods.
 *
 * @param type - BDP frame type
 * @param pairId - The sync pair this frame belongs to
 * @param fromDeviceId - Sender's device ID
 * @returns Partial frame with all header fields populated
 */
export function makeHeader(
  type: BDPFrame["type"],
  pairId: PairId,
  fromDeviceId: DeviceId,
) {
  return {
    cp: true as const,
    v: 1 as const,
    type,
    pairId,
    msgId: makeMsgId(),
    fromDeviceId,
    ts: Date.now(),
  };
}

/**
 * Tries to decode a raw DataChannel message as a BDP frame.
 * Returns null instead of throwing on failure — safe for use in
 * event handlers where throwing would crash the session.
 *
 * Calls isBDPMessage() internally; callers do NOT need to call it first.
 *
 * @param raw - Raw DataChannel message
 * @returns DecodeResult on success, null on failure (not a BDP message or malformed)
 */
export function tryDecodeFrame(
  raw: string | ArrayBuffer,
): DecodeResult | null {
  if (!isBDPMessage(raw)) return null;

  try {
    return decodeFrame(raw);
  } catch {
    // Malformed BDP message (bad JSON, wrong structure, etc.)
    // Log in dev, silent in prod — do not let the decode error escape
    if (import.meta.env.DEV) {
      console.warn("[BDP] Failed to decode frame:", raw);
    }
    return null;
  }
}
