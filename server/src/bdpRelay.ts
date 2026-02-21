/**
 * BDP — Delta Relay Server (C1)
 *
 * Three HTTP endpoints bolted onto the existing signaling HTTP server.
 * The relay stores encrypted envelopes on behalf of offline peers.
 * The server is completely blind to the content — it only handles
 * opaque base64 blobs; all encryption/decryption happens client-side.
 *
 * Endpoints:
 *   POST   /bdp/relay/push          — store an encrypted envelope
 *   GET    /bdp/relay/pull          — fetch envelopes since a timestamp
 *   DELETE /bdp/relay/clear         — remove old envelopes
 *
 * Constraints (matching BDP_CONSTANTS on the client):
 *   - Max envelope size:    64 KB  (65 536 bytes raw / ~87 380 base64 chars)
 *   - Max envelopes/pair:   100    (oldest evicted when over limit)
 *   - Envelope TTL:         30 days
 *   - Rate limit:           60 pushes / hour per pairId (token bucket)
 *
 * No persistent storage — all data lives in memory and is lost on restart.
 * That is intentional: the relay is a best-effort async bridge, not a
 * primary store. Peers that miss envelopes will do a full index exchange
 * on the next direct connection.
 */

import type { IncomingMessage, ServerResponse } from "http";

// ─────────────────────────────────────────────────────────────────────────────
// Relay configuration
// ─────────────────────────────────────────────────────────────────────────────

/** Allowed CORS origins. null = allow any (development default). */
let _allowedOrigins: string[] | null = null;

/**
 * Configures the relay module with deployment-specific settings.
 * Must be called before the HTTP server starts handling requests.
 *
 * @param opts.allowedOrigins - Whitelist of allowed CORS origins.
 *   If omitted or empty the relay echoes any origin back (dev-friendly).
 *   In production, pass the value of the ALLOWED_ORIGINS env variable.
 */
export function configureRelay(opts: { allowedOrigins?: string[] }): void {
  _allowedOrigins =
    opts.allowedOrigins && opts.allowedOrigins.length > 0
      ? opts.allowedOrigins
      : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants (mirror BDP_CONSTANTS from the client)
// ─────────────────────────────────────────────────────────────────────────────

const RELAY_MAX_ENVELOPE_SIZE = 65_536; // bytes (raw, before base64)
const RELAY_MAX_ENVELOPES_PER_PAIR = 100;
const RELAY_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const RATE_LIMIT_MAX_PUSHES = 60; // per pairId per window

// base64 overhead: every 3 raw bytes → 4 chars, so max base64 len ≈ size * 4/3
const MAX_CIPHERTEXT_B64_CHARS =
  Math.ceil((RELAY_MAX_ENVELOPE_SIZE * 4) / 3) + 4;
const NONCE_B64_CHARS = Math.ceil((12 * 4) / 3); // 12-byte nonce → 16 chars
const AUTH_TAG_B64_CHARS = Math.ceil((16 * 4) / 3); // 16-byte auth tag → 24 chars

// ─────────────────────────────────────────────────────────────────────────────
// In-memory store
// ─────────────────────────────────────────────────────────────────────────────

interface StoredEnvelope {
  id: string;
  pairId: string;
  fromDeviceId: string;
  nonce: string;
  ciphertext: string;
  authTag: string;
  /** Raw size estimate (ciphertext base64 decoded) */
  size: number;
  createdAt: number;
  expiresAt: number;
}

/** pairId → sorted array of envelopes (oldest first) */
const relayStore = new Map<string, StoredEnvelope[]>();

// ─────────────────────────────────────────────────────────────────────────────
// Rate limiter (simple token bucket per pairId)
// ─────────────────────────────────────────────────────────────────────────────

interface RateBucket {
  count: number;
  windowStart: number;
}

const rateBuckets = new Map<string, RateBucket>();

function checkRateLimit(pairId: string): boolean {
  const now = Date.now();
  const bucket = rateBuckets.get(pairId);

  if (!bucket || now - bucket.windowStart > RATE_LIMIT_WINDOW_MS) {
    // New window
    rateBuckets.set(pairId, { count: 1, windowStart: now });
    return true;
  }

  if (bucket.count >= RATE_LIMIT_MAX_PUSHES) {
    return false; // over limit
  }

  bucket.count++;
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// TTL eviction — runs every 10 minutes
// ─────────────────────────────────────────────────────────────────────────────

setInterval(
  () => {
    const now = Date.now();
    for (const [pairId, envelopes] of relayStore.entries()) {
      const live = envelopes.filter((e) => e.expiresAt > now);
      if (live.length === 0) {
        relayStore.delete(pairId);
      } else {
        relayStore.set(pairId, live);
      }
    }
    // Also evict stale rate limit buckets
    for (const [pairId, bucket] of rateBuckets.entries()) {
      if (now - bucket.windowStart > RATE_LIMIT_WINDOW_MS * 2) {
        rateBuckets.delete(pairId);
      }
    }
  },
  10 * 60 * 1000,
);

// ─────────────────────────────────────────────────────────────────────────────
// HTTP body reader
// ─────────────────────────────────────────────────────────────────────────────

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString();
      // Bail out early if the body is absurdly large (10 × max envelope)
      if (body.length > RELAY_MAX_ENVELOPE_SIZE * 10) {
        req.destroy();
        reject(new Error("Request body too large"));
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Response helpers
// ─────────────────────────────────────────────────────────────────────────────

function sendJSON(
  res: ServerResponse,
  status: number,
  body: unknown,
  origin: string,
): void {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(json),
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store",
  });
  res.end(json);
}

function sendError(
  res: ServerResponse,
  status: number,
  message: string,
  origin: string,
): void {
  sendJSON(res, status, { error: message }, origin);
}

// ─────────────────────────────────────────────────────────────────────────────
// Input validation helpers
// ─────────────────────────────────────────────────────────────────────────────

function isString(v: unknown): v is string {
  return typeof v === "string";
}

function isValidId(v: unknown, maxLen = 64): v is string {
  return isString(v) && v.length >= 1 && v.length <= maxLen;
}

function isBase64(v: unknown): v is string {
  if (!isString(v)) return false;
  return /^[A-Za-z0-9+/]*={0,2}$/.test(v);
}

function base64ByteLength(b64: string): number {
  // Each group of 4 chars decodes to 3 bytes; subtract padding
  const padding = (b64.match(/={1,2}$/) ?? [""])[0].length;
  return Math.floor((b64.length * 3) / 4) - padding;
}

// ─────────────────────────────────────────────────────────────────────────────
// Handlers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /bdp/relay/push
 *
 * Body (JSON):
 *   pairId:       string (1–64 chars)
 *   fromDeviceId: string (1–64 chars)
 *   nonce:        base64, 16 chars (12 decoded bytes)
 *   ciphertext:   base64, max ~87 380 chars (65 536 decoded bytes)
 *   authTag:      base64, 24 chars (16 decoded bytes)
 *
 * Returns: { id: string, expiresAt: number }
 */
async function handlePush(
  req: IncomingMessage,
  res: ServerResponse,
  origin: string,
): Promise<void> {
  let rawBody: string;
  try {
    rawBody = await readBody(req);
  } catch {
    sendError(res, 400, "Failed to read request body", origin);
    return;
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    sendError(res, 400, "Invalid JSON body", origin);
    return;
  }

  if (typeof body !== "object" || body === null) {
    sendError(res, 400, "Body must be a JSON object", origin);
    return;
  }

  const { pairId, fromDeviceId, nonce, ciphertext, authTag } = body as Record<
    string,
    unknown
  >;

  // ── Field validation ──────────────────────────────────────────────────────

  if (!isValidId(pairId)) {
    sendError(res, 400, "Invalid pairId: must be a string 1–64 chars", origin);
    return;
  }
  if (!isValidId(fromDeviceId)) {
    sendError(
      res,
      400,
      "Invalid fromDeviceId: must be a string 1–64 chars",
      origin,
    );
    return;
  }
  if (!isBase64(nonce) || nonce.length !== NONCE_B64_CHARS) {
    sendError(
      res,
      400,
      `Invalid nonce: must be base64 of exactly ${NONCE_B64_CHARS} chars (12 bytes)`,
      origin,
    );
    return;
  }
  if (!isBase64(ciphertext) || ciphertext.length > MAX_CIPHERTEXT_B64_CHARS) {
    sendError(
      res,
      400,
      `Invalid ciphertext: must be base64, max ${MAX_CIPHERTEXT_B64_CHARS} chars`,
      origin,
    );
    return;
  }
  if (!isBase64(authTag) || authTag.length !== AUTH_TAG_B64_CHARS) {
    sendError(
      res,
      400,
      `Invalid authTag: must be base64 of exactly ${AUTH_TAG_B64_CHARS} chars (16 bytes)`,
      origin,
    );
    return;
  }

  // ── Size check ────────────────────────────────────────────────────────────

  const rawSize = base64ByteLength(ciphertext);
  if (rawSize > RELAY_MAX_ENVELOPE_SIZE) {
    sendError(
      res,
      413,
      `Envelope too large: ${rawSize} bytes (max ${RELAY_MAX_ENVELOPE_SIZE})`,
      origin,
    );
    return;
  }

  // ── Rate limit ────────────────────────────────────────────────────────────

  if (!checkRateLimit(pairId)) {
    sendError(
      res,
      429,
      `Rate limit exceeded: max ${RATE_LIMIT_MAX_PUSHES} pushes per hour per pairId`,
      origin,
    );
    return;
  }

  // ── Store ─────────────────────────────────────────────────────────────────

  const now = Date.now();
  const id = crypto.randomUUID();

  const envelope: StoredEnvelope = {
    id,
    pairId,
    fromDeviceId,
    nonce,
    ciphertext,
    authTag,
    size: rawSize,
    createdAt: now,
    expiresAt: now + RELAY_TTL_MS,
  };

  let envelopes = relayStore.get(pairId) ?? [];

  // Evict expired ones first
  envelopes = envelopes.filter((e) => e.expiresAt > now);

  // Enforce per-pair cap — evict oldest if over limit
  while (envelopes.length >= RELAY_MAX_ENVELOPES_PER_PAIR) {
    envelopes.shift(); // remove oldest
  }

  envelopes.push(envelope);
  relayStore.set(pairId, envelopes);

  console.log(
    `[BDP relay] push  pairId=${pairId} id=${id} size=${rawSize}B total=${envelopes.length}`,
  );

  sendJSON(res, 201, { id, expiresAt: envelope.expiresAt }, origin);
}

/**
 * GET /bdp/relay/pull?pairId=X&since=T
 *
 * Query params:
 *   pairId: string (required)
 *   since:  number — Unix ms timestamp (default 0 = all)
 *
 * Returns: { envelopes: StoredEnvelope[], serverTime: number }
 */
function handlePull(
  req: IncomingMessage,
  res: ServerResponse,
  origin: string,
): void {
  const urlObj = new URL(req.url ?? "", "http://localhost");
  const pairId = urlObj.searchParams.get("pairId");
  const sinceRaw = urlObj.searchParams.get("since");

  if (!pairId || !isValidId(pairId)) {
    sendError(res, 400, "Missing or invalid pairId query parameter", origin);
    return;
  }

  const since = sinceRaw ? parseInt(sinceRaw, 10) : 0;
  if (isNaN(since) || since < 0) {
    sendError(
      res,
      400,
      "Invalid since parameter: must be a non-negative integer",
      origin,
    );
    return;
  }

  const now = Date.now();
  const stored = relayStore.get(pairId) ?? [];

  // TTL filter + since filter
  const result = stored.filter((e) => e.expiresAt > now && e.createdAt > since);

  console.log(
    `[BDP relay] pull  pairId=${pairId} since=${since} returned=${result.length}`,
  );

  sendJSON(res, 200, { envelopes: result, serverTime: now }, origin);
}

/**
 * DELETE /bdp/relay/clear?pairId=X&upTo=T
 *
 * Query params:
 *   pairId: string (required)
 *   upTo:   number — Unix ms timestamp, delete envelopes created before this
 *
 * Returns: { deleted: number }
 */
function handleClear(
  req: IncomingMessage,
  res: ServerResponse,
  origin: string,
): void {
  const urlObj = new URL(req.url ?? "", "http://localhost");
  const pairId = urlObj.searchParams.get("pairId");
  const upToRaw = urlObj.searchParams.get("upTo");

  if (!pairId || !isValidId(pairId)) {
    sendError(res, 400, "Missing or invalid pairId query parameter", origin);
    return;
  }

  const upTo = upToRaw ? parseInt(upToRaw, 10) : Date.now();
  if (isNaN(upTo) || upTo < 0) {
    sendError(
      res,
      400,
      "Invalid upTo parameter: must be a non-negative integer",
      origin,
    );
    return;
  }

  const existing = relayStore.get(pairId) ?? [];
  const kept = existing.filter((e) => e.createdAt >= upTo);
  const deleted = existing.length - kept.length;

  if (kept.length === 0) {
    relayStore.delete(pairId);
  } else {
    relayStore.set(pairId, kept);
  }

  console.log(
    `[BDP relay] clear pairId=${pairId} upTo=${upTo} deleted=${deleted}`,
  );

  sendJSON(res, 200, { deleted }, origin);
}

// ─────────────────────────────────────────────────────────────────────────────
// Route registration
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns the CORS origin to reflect in response headers.
 *
 * - If allowedOrigins is configured, returns the request origin only when it
 *   appears in the whitelist; otherwise returns the first allowed origin as a
 *   safe fallback (browsers will block the response anyway).
 * - If no allowedOrigins are configured (development mode), echoes the
 *   request origin back, or '*' when the request carries no origin header.
 */
function getOrigin(req: IncomingMessage): string {
  const requestOrigin = req.headers["origin"] as string | undefined;

  if (_allowedOrigins === null) {
    // Development / unconfigured: permissive
    return requestOrigin ?? "*";
  }

  if (requestOrigin && _allowedOrigins.includes(requestOrigin)) {
    return requestOrigin;
  }

  // Origin not in whitelist — return the first allowed origin so the header
  // is present but the browser will still block the cross-origin response.
  return _allowedOrigins[0] ?? "*";
}

/**
 * Registers the three BDP relay HTTP routes onto the existing signaling server's
 * request listener. Must be called before the server starts listening.
 *
 * Integration: call this from server/src/index.ts BEFORE the httpServer is
 * created, passing the handler function to the createServer call:
 *
 *   const httpServer = createServer((req, res) => {
 *     if (handleBDPRelayRequest(req, res)) return   // ← BDP routes
 *     // ... existing health-check handler ...
 *   })
 *
 * @param handler - The existing createServer request callback, returned wrapped.
 */
export function handleBDPRelayRequest(
  req: IncomingMessage,
  res: ServerResponse,
): boolean {
  const url = req.url ?? "";
  const method = req.method ?? "GET";
  const origin = getOrigin(req);

  // Handle CORS preflight for all BDP routes
  if (method === "OPTIONS" && url.startsWith("/bdp/")) {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
    });
    res.end();
    return true;
  }

  if (method === "POST" && url === "/bdp/relay/push") {
    void handlePush(req, res, origin);
    return true;
  }

  if (method === "GET" && url.startsWith("/bdp/relay/pull")) {
    handlePull(req, res, origin);
    return true;
  }

  if (method === "DELETE" && url.startsWith("/bdp/relay/clear")) {
    handleClear(req, res, origin);
    return true;
  }

  // Not a BDP route
  return false;
}

/**
 * Returns a diagnostic snapshot of the relay store for health-check endpoints.
 */
export function getBDPRelayStats(): {
  totalPairs: number;
  totalEnvelopes: number;
  oldestEnvelopeAge: number | null;
} {
  let total = 0;
  let oldest: number | null = null;
  const now = Date.now();

  for (const envelopes of relayStore.values()) {
    total += envelopes.length;
    for (const e of envelopes) {
      const age = now - e.createdAt;
      if (oldest === null || age > oldest) oldest = age;
    }
  }

  return {
    totalPairs: relayStore.size,
    totalEnvelopes: total,
    oldestEnvelopeAge: oldest,
  };
}
