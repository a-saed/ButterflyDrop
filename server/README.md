# Butterfly Drop Signaling Server

Minimal WebSocket signaling server for WebRTC peer-to-peer file sharing.

## Features

- WebSocket-based signaling for SDP/ICE exchange
- In-memory session management
- Automatic session cleanup (30min timeout)
- No file data touches the server (privacy-first)

## Setup

```bash
cd server
pnpm install
```

## Development

```bash
pnpm dev
```

Server runs on `ws://localhost:8080` by default.

## Production

```bash
pnpm build
pnpm start
```

## Environment Variables

- `PORT` - WebSocket server port (default: 8080)

## Message Protocol

### Session Creation
- **Sender**: `{ type: 'session-create', sessionId: '...' }`
- **Receiver**: `{ type: 'session-join', sessionId: '...' }`

### WebRTC Signaling
- **Offer**: `{ type: 'offer', sessionId: '...', data: RTCSessionDescriptionInit }`
- **Answer**: `{ type: 'answer', sessionId: '...', data: RTCSessionDescriptionInit }`
- **ICE Candidate**: `{ type: 'ice-candidate', sessionId: '...', data: RTCIceCandidateInit }`

### Session Cleanup
- **Leave**: `{ type: 'session-leave', sessionId: '...' }`

## Architecture

- **No file data** ever touches the server
- Sessions are **ephemeral** (in-memory only)
- **Automatic cleanup** of stale sessions
- **Peer-to-peer** file transfer via WebRTC DataChannels

