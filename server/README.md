# 🦋 Butterfly Drop - Signaling Server

WebSocket signaling server for WebRTC peer-to-peer file sharing.

## 🚀 Quick Start

```bash
# Install dependencies
pnpm install

# Development
pnpm dev

# Build
pnpm build

# Production
pnpm start
```

## 📦 Deployment

This server is configured for deployment to **Render** via `render.yaml` in the root directory.

For deployment instructions, see the main [README.md](../README.md) or check the Render configuration in `render.yaml`.

## ⚙️ Environment Variables

- `NODE_ENV` - Set to `production` for production
- `PORT` - Server port (default: 8080)
- `ALLOWED_ORIGINS` - Comma-separated list of allowed CORS origins

## 🔧 How It Works

The signaling server facilitates WebRTC connection setup by:
1. Managing WebSocket connections for peers
2. Exchanging SDP offers/answers
3. Relaying ICE candidates
4. Broadcasting peer lists

**Important**: No file data ever touches this server - it only handles signaling for WebRTC connection setup.

## Features

- WebSocket-based signaling for SDP/ICE exchange
- In-memory session management
- Automatic session cleanup (30min timeout)
- No file data touches the server (privacy-first)

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

