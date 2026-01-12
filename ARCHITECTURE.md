# Network Discovery Architecture

## Current (Link-based)
- 1-to-1 sessions (sender ↔ receiver)
- URL required to connect
- No automatic discovery

## New (Network-based)
- Multi-peer networks (3+ peers)
- Automatic discovery on same network
- Any peer can send to any peer
- Room/network concept

## Implementation Plan

### 1. Network Concept
- Replace "session" with "network"
- Network ID = session ID (backward compatible)
- Multiple peers can join same network

### 2. Signaling Server Changes
- `network-create`: Create a network
- `network-join`: Join a network (multiple allowed)
- `network-list`: Get list of available networks
- `peer-announce`: Announce peer presence
- `peer-list`: Get list of peers in network

### 3. WebRTC Changes
- Multiple RTCPeerConnections (one per peer)
- Multiple data channels (one per peer connection)
- Mesh topology (each peer connects to all others)

### 4. Peer Discovery
- Broadcast peer presence via signaling server
- Show all peers in network
- Auto-refresh peer list

### 5. File Transfer
- Select target peer(s)
- Send files to selected peer(s)
- Support multiple simultaneous transfers

