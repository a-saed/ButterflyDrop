# Snapdrop-Style WebRTC Refactor

## Overview

This document describes the major refactor to adopt Snapdrop's architecture pattern for WebRTC connections.

## Problem We Solved

### Before (Broken)
- Connections were established **on-demand** when user clicked "Send"
- Race conditions between ICE candidates and SDP offer/answer
- `peerConnectionRef.current` was null when receiving ICE candidates
- Users had to wait 30+ seconds for connections that often failed
- Complex promise-based connection establishment with timeouts

### After (Fixed)
- Connections are **auto-established** when peers join the session
- All peers maintain ready connections to each other
- Clicking "Send" uses an already-open connection - instant transfer!
- No race conditions - proper sequential message processing
- Clean, simple architecture

## Architecture Changes

### 1. Connection Lifecycle

**Old Flow:**
```
User joins session → Discovers peers → User clicks "Send" → Establish WebRTC → Transfer files
                                        ⬆️ This took 30+ seconds and often failed
```

**New Flow:**
```
User joins session → Discovers peers → Auto-establish WebRTC connections → Ready!
                                       ⬆️ Happens automatically in background
Later: User clicks "Send" → Transfer files instantly
```

### 2. Peer Connection Management

**Before:**
- Single peer connection stored in refs
- Created/destroyed for each transfer
- No clear ownership of connections

**After:**
- Map of `peerId → PeerConnectionState`
- Each peer connection persists until peer leaves
- Clear ownership: one connection per peer pair

```typescript
interface PeerConnectionState {
  pc: RTCPeerConnection;
  dataChannel: RTCDataChannel | null;
  isConnected: boolean;
  isOfferer: boolean;
  iceCandidateQueue: RTCIceCandidateInit[];
}
```

### 3. Connection Initiation Strategy

To avoid both peers initiating simultaneously, we use **ID comparison**:

```typescript
const shouldInitiate = myId < peer.id;
```

- Peer with **lower ID** creates the offer
- Peer with **higher ID** waits for offer and creates answer
- Deterministic and symmetric - no coordination needed!

### 4. Sequential Message Processing

**Problem:** Concurrent async message handlers caused race conditions:
```
Thread 1: Receive answer → start setting remote description...
Thread 2: Receive ICE candidate → check remote description (null) → queue ❌
Thread 1: ...finish setting remote description ✅
```

**Solution:** Message queue in SignalingClient:
```typescript
private messageQueue: SignalingMessage[] = [];
private isProcessingQueue = false;

private async processMessageQueue() {
  this.isProcessingQueue = true;
  while (this.messageQueue.length > 0) {
    const message = this.messageQueue.shift();
    await this.emitAsync("message", message); // Wait for completion
  }
  this.isProcessingQueue = false;
}
```

Now messages are processed **one at a time, in order**.

## API Changes

### useWebRTC Hook

**Before:**
```typescript
const { isConnected, dataChannel, initiateConnection } = useWebRTC();

// Had to call initiateConnection and wait
await initiateConnection(peerId);
```

**After:**
```typescript
const { getDataChannelForPeer, isPeerReady, readyPeers } = useWebRTC();

// Connections auto-established, just check if ready
if (isPeerReady(peerId)) {
  const channel = getDataChannelForPeer(peerId);
  // Use channel immediately!
}
```

### useFileTransfer Hook

**Before:**
```typescript
const { sendFiles } = useFileTransfer();
// Used internal dataChannel from useWebRTC
await sendFiles(files);
```

**After:**
```typescript
const { sendFiles, setupReceiver } = useFileTransfer();
// Accepts dataChannel as parameter for cleaner separation
await sendFiles(files, dataChannel);
setupReceiver(dataChannel);
```

### App.tsx Send Flow

**Before:**
```typescript
const handleSend = async () => {
  // Initiate connection (takes 30+ seconds)
  await initiateConnection(selectedPeerId);
  
  // Wait arbitrarily
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // Check if connected
  if (!dataChannel) {
    throw new Error("Failed to establish connection");
  }
  
  // Finally send
  await sendFiles(selectedFiles);
};
```

**After:**
```typescript
const handleSend = async () => {
  // Check if ready (instant)
  if (!isPeerReady(selectedPeerId)) {
    toast.error("Peer not ready");
    return;
  }
  
  // Get channel (instant)
  const dataChannel = getDataChannelForPeer(selectedPeerId);
  
  // Send immediately (no waiting!)
  await sendFiles(selectedFiles, dataChannel);
};
```

## Benefits

### 1. **Instant File Transfer**
- No waiting when clicking "Send"
- Connections are ready before user decides to send
- Better UX, feels responsive

### 2. **More Reliable**
- No race conditions
- Sequential message processing
- Proper connection state tracking

### 3. **Cleaner Code**
- Clear separation of concerns
- Each peer connection is independent
- Easy to debug and maintain

### 4. **Scalable**
- Multiple peer support built-in
- Any peer can send to any other peer
- No hardcoded sender/receiver roles

### 5. **Better Error Handling**
- Clear connection states per peer
- Easy to show "Peer not ready" messages
- Graceful handling of connection failures

## Implementation Details

### Connection Establishment

1. **Peer joins session**
   ```
   Session join → Receive peer list → Compare peer IDs
   ```

2. **Determine who initiates**
   ```
   if (myId < peerId) {
     // I initiate - create offer
     initiateConnectionToPeer(peerId);
   } else {
     // They initiate - wait for offer
   }
   ```

3. **WebRTC handshake**
   ```
   Offerer: Create offer → Send offer → Wait for answer
   Answerer: Receive offer → Create answer → Send answer
   Both: Exchange ICE candidates
   ```

4. **Connection ready**
   ```
   Data channel opens → Add to readyPeers set → UI updates
   ```

### Message Handling

All signaling messages are handled in `useWebRTC`:

- `offer` → `handleOffer(peerId, offer)`
- `answer` → `handleAnswer(peerId, answer)`
- `ice-candidate` → `handleIceCandidate(peerId, candidate)`
- `session-join` / `peer-list` → `handlePeerListUpdate(peers)`

Each handler operates on the specific peer's connection state.

### ICE Candidate Queueing

ICE candidates can arrive before the remote description is set. We queue them:

```typescript
if (state.pc.remoteDescription) {
  // Remote description set - add immediately
  await state.pc.addIceCandidate(candidate);
} else {
  // No remote description yet - queue for later
  state.iceCandidateQueue.push(candidate);
}
```

After setting remote description:
```typescript
await state.pc.setRemoteDescription(answer);

// Process queued candidates
for (const candidate of state.iceCandidateQueue) {
  await state.pc.addIceCandidate(candidate);
}
state.iceCandidateQueue = [];
```

## Testing

### Expected Behavior

1. **Open app in two tabs/devices**
   - Both should auto-discover each other
   - Connections establish automatically in background
   - Toast notification: "Peer connection ready!"

2. **Select files and peer**
   - Peer should show as "ready" (green indicator)
   - Click "Send"
   - Files transfer immediately without delay

3. **Logs should show**
   ```
   🚀 Initiating connection to peer abc123...
   📤 Sending offer to peer abc123
   📥 Received answer from peer abc123
   ✅ Remote description set for abc123
   🧊 Processing 3 queued ICE candidates for abc123
   ✅ Data channel opened with abc123 (offerer)
   🔗 Connection state with abc123: connected
   ✅ WebRTC connection ready with abc123
   ```

### Debug Tips

- Check `readyPeers` array in React DevTools
- Monitor connection state changes in console
- Verify data channel `readyState === "open"`
- Look for ICE candidate processing logs

## Future Improvements

1. **Connection Keep-Alive**
   - Send periodic ping messages
   - Detect and reconnect dead connections

2. **Parallel Transfers**
   - Support sending to multiple peers simultaneously
   - Queue transfers if needed

3. **Better Error Recovery**
   - Auto-retry failed connections
   - Fallback to TURN servers if direct connection fails

4. **Performance Optimizations**
   - Reuse connections for multiple transfers
   - Implement transfer resumption
   - Add congestion control

## Migration Guide

### For Developers

If you have custom code using the old API:

**Update imports:**
```typescript
// Old
import { useWebRTC } from '@/hooks/useWebRTC';

// New (same import, different API)
import { useWebRTC } from '@/hooks/useWebRTC_v2';
```

**Update connection checks:**
```typescript
// Old
if (isConnected && dataChannel) { ... }

// New
if (isPeerReady(peerId)) {
  const channel = getDataChannelForPeer(peerId);
  ...
}
```

**Update file sending:**
```typescript
// Old
await sendFiles(files);

// New
const channel = getDataChannelForPeer(peerId);
await sendFiles(files, channel);
```

**Update receiver setup:**
```typescript
// Old
useEffect(() => {
  if (dataChannel) setupReceiver();
}, [dataChannel]);

// New
useEffect(() => {
  readyPeers.forEach(peerId => {
    const channel = getDataChannelForPeer(peerId);
    if (channel) setupReceiver(channel);
  });
}, [readyPeers]);
```

## Conclusion

This refactor brings Butterfly Drop in line with proven P2P file sharing apps like Snapdrop. The key insight is: **establish connections early, transfer instantly**. This provides a much better user experience and eliminates the complex promise-based waiting logic that was causing issues.

The architecture is now cleaner, more reliable, and ready for future enhancements.

---

**Author:** AI Assistant  
**Date:** 2024  
**Status:** ✅ Complete