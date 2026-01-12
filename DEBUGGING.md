# Debugging Peer Discovery

## Issue
Peers not appearing when connecting to the same network/session.

## Root Cause Analysis

### Flow Breakdown

1. **Tab 1 (Sender):**
   - Creates session with `generateSessionId()`
   - Sends `session-create` to server with device info
   - Should receive back `session-create` confirmation with peers list
   - Initializes WebRTC as sender

2. **Tab 2 (Receiver):**
   - Extracts session ID from URL
   - Sends `session-join` to server with device info
   - Should receive back `session-join` confirmation with peers list
   - Initializes WebRTC as receiver

3. **Server:**
   - Receives `session-create` → creates session → adds peer to `session.peers`
   - Broadcasts `peer-list` to all peers
   - Returns confirmation with `peers` array

## Debugging Steps

1. **Check browser console for logs:**
   ```
   - "Creating new session..." or "Joining session..."
   - "Initializing WebRTC as sender/receiver..."
   - "Sender/Receiver got message: session-create/session-join"
   - "Peers in network: [...]"
   - "Peer discovery: session=true, isConnected=true..."
   - "Returning X peers: [...]"
   ```

2. **Check server logs:**
   ```
   - "Received message: session-create"
   - "Session created: {sessionId} (peer {name} connected)"
   - "Received message: session-join"
   - "Session joined: {sessionId} (peer {name} connected)"
   ```

3. **Check Network tab:**
   - WebSocket connection to `ws://localhost:8080`
   - Messages being sent/received

## Expected Behavior

- Tab 1 opens → Creates session → Should see "Scanning for devices..." (no peers yet, as it's the only one)
- Tab 2 opens with Tab 1's URL → Joins session → Both tabs should see each other as peers
- Tab 3 opens with same URL → Joins session → All 3 tabs should see each other

## Common Issues

1. **WebSocket not connecting:** Check if server is running on port 8080
2. **Session not created:** Check `session-create` message is being sent
3. **Peers not updating:** Check `setPeers()` is being called with non-empty array
4. **Peers not showing in UI:** Check `usePeerDiscovery` is returning non-empty array

## Current Status

Adding logging to trace:
- Session creation/joining
- Message sending/receiving
- Peer list updates
- Peer discovery hook execution

