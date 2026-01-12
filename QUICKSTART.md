# Quick Start Guide

## Setup

1. **Install dependencies:**
   ```bash
   # Root (frontend)
   pnpm install
   
   # Server
   cd server
   pnpm install
   ```

2. **Start the signaling server:**
   ```bash
   cd server
   pnpm dev
   ```
   Server runs on `ws://localhost:8080`

3. **Start the frontend (in a new terminal):**
   ```bash
   pnpm dev
   ```
   Frontend runs on `http://localhost:5173`

## Testing File Transfer

1. **Open two browser tabs/windows:**
   - Tab 1: Sender (creates session automatically)
   - Tab 2: Receiver (paste the shareable URL from Tab 1)

2. **On Sender (Tab 1):**
   - Wait for "Connected to peer!" toast
   - Select files (drag & drop or click)
   - Click "Send" button
   - Watch the butterfly progress animation

3. **On Receiver (Tab 2):**
   - Wait for connection
   - Files will be received automatically
   - Progress will be shown

## Troubleshooting

- **Connection fails:** Make sure signaling server is running
- **Files not transferring:** Check browser console for errors
- **WebRTC issues:** Some networks require TURN servers (not configured in MVP)

## Architecture

- **Frontend:** React + Vite + TypeScript
- **Signaling Server:** Node.js + WebSocket (ws)
- **File Transfer:** WebRTC DataChannels (peer-to-peer)
- **No file data touches the server** (privacy-first)

