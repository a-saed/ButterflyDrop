# 🦋 Butterfly Drop - Current State & Issues

## 📊 Project Overview

**Butterfly Drop** is a cross-platform PWA for peer-to-peer file sharing using WebRTC DataChannels. The app follows a Snapdrop-style architecture where connections are auto-established when peers join a session.

---

## 🏗 Architecture Summary

### Client (Frontend)
- **Framework**: React 18+ with TypeScript, Vite
- **UI**: Tailwind CSS + shadcn/ui components
- **State Management**: React Context API (SessionContext, ConnectionContext, ThemeContext)
- **WebRTC**: Custom hook (`useWebRTC_v2.ts`) managing peer connections
- **File Transfer**: Chunked streaming via RTCDataChannel (256KB chunks)
- **PWA**: Configured with vite-plugin-pwa

### Server (Signaling)
- **Runtime**: Node.js with TypeScript
- **Protocol**: WebSocket (ws library)
- **Purpose**: WebRTC signaling only (SDP exchange, ICE candidates)
- **Storage**: In-memory session/peer management
- **Features**: 
  - Session management with auto-cleanup (30min timeout)
  - Peer discovery and broadcasting
  - Multi-peer support (P2P network)

---

## ✅ What's Working

1. **Session Management**
   - Session creation and joining via URL/QR code
   - Session ID generation and sharing
   - Auto-expiration after 30 minutes

2. **Peer Discovery**
   - Peers join session via signaling server
   - Peer list broadcasting to all participants
   - Self-filtering (peers don't see themselves)

3. **WebRTC Connection**
   - Auto-establishment when peers join
   - Polite/impolite pattern (ID-based initiation)
   - ICE candidate queueing
   - Data channel creation and management

4. **File Transfer**
   - Single and multiple file support
   - Chunked streaming (256KB chunks)
   - Transfer progress tracking
   - File metadata transmission

5. **UI/UX**
   - Drag & drop file selection
   - Peer network visualization
   - Transfer progress indicators
   - Connection status display
   - QR code generation
   - PWA install support

---

## 🐛 Issues in `useWebRTC_v2.ts`

### 1. **Type Errors** (Critical)

#### Issue 1.1: RTCSessionDescription null assignment
```typescript
// Line 242
data: state.pc.localDescription,  // ❌ Type error: can be null
```
**Problem**: `localDescription` can be `null`, but `SignalingMessage.data` doesn't accept `null`.

**Fix**: Add null check or use non-null assertion after `setLocalDescription`.

#### Issue 1.2: Missing `isOnline` property
```typescript
// Lines 410, 458
setPeers(otherPeers);  // ❌ Missing isOnline property
```
**Problem**: `otherPeers` array doesn't include `isOnline` property required by `PeerInfo` type.

**Fix**: Add `isOnline: true` when creating peer objects.

### 2. **React Hook Dependency Warnings**

#### Issue 2.1: Missing `session` dependency
```typescript
// Line 460
const handlePeerListUpdate = useCallback(
  (peers) => { /* uses session */ },
  [setPeers, initiateConnectionToPeer]  // ❌ Missing 'session'
);
```
**Problem**: Uses `session` in closure but not in dependency array.

**Fix**: Add `session` to dependencies or use `session?.id` if only ID is needed.

#### Issue 2.2: Missing `session` dependency in `initialize`
```typescript
// Line 630
const initialize = useCallback(async () => {
  if (!session || hasInitializedRef.current) return;
  // ...
}, [session?.id, /* ... */]);  // ❌ Should include full 'session'
```
**Problem**: Uses `session` object but only depends on `session?.id`.

**Fix**: Include `session` in dependencies or restructure to only use `session.id`.

#### Issue 2.3: Missing dependencies in `useEffect`
```typescript
// Line 687
useEffect(() => {
  if (!session) {
    cleanup();
    return;
  }
  initialize();
  return cleanup;
}, [session?.id]);  // ❌ Missing 'cleanup' and 'initialize'
```
**Problem**: Missing dependencies can cause stale closures.

**Fix**: Add `cleanup` and `initialize` to dependencies, or wrap them with `useCallback` properly.

### 3. **React Compiler Memoization Issues**

#### Issue 3.1: `handlePeerListUpdate` memoization
```
Line 391: React Compiler skipped optimization
Inferred dependency: `session`
Source dependencies: [setPeers, initiateConnectionToPeer]
```
**Problem**: Dependency mismatch causes compiler to skip optimization.

**Fix**: Align dependencies with actual usage.

#### Issue 3.2: `initialize` memoization
```
Line 499: React Compiler skipped optimization
Inferred dependency: `session`
Source dependencies: [session?.id, ...]
```
**Problem**: Using `session?.id` but compiler infers full `session` is needed.

**Fix**: Use consistent dependency (either `session` or `session?.id`).

### 4. **Potential Race Conditions**

#### Issue 4.1: Session state in `handlePeerListUpdate`
```typescript
// Line 391-460
const handlePeerListUpdate = useCallback(
  (peers) => {
    // Uses session from closure, but session might be stale
    if (!session || !signalingRef.current) return;
    // ...
  },
  [setPeers, initiateConnectionToPeer]  // session not in deps
);
```
**Problem**: `session` might be stale when callback executes.

**Fix**: Use `session?.id` from ref or add proper dependency.

#### Issue 4.2: Polite/impolite pattern timing
```typescript
// Line 427-445
const isPolite = myId > peer.id;
if (!isPolite) {
  initiateConnectionToPeer(peer.id);  // Might race if both peers do this
}
```
**Problem**: Both peers might initiate if timing is off.

**Fix**: Add connection state check before initiating.

### 5. **Error Handling Gaps**

#### Issue 5.1: No error handling for failed offer creation
```typescript
// Line 229-249
state.pc.createOffer()
  .then((offer) => { /* ... */ })
  .catch((error) => {
    console.error(`❌ Failed to create/send offer for ${peerId}:`, error);
    peerConnectionsRef.current.delete(peerId);
    // ❌ No user-facing error notification
  });
```
**Problem**: Errors are logged but not shown to user.

**Fix**: Call `setConnectionError` or show toast notification.

#### Issue 5.2: No retry logic for failed connections
**Problem**: If WebRTC connection fails, there's no automatic retry.

**Fix**: Add retry mechanism with exponential backoff.

### 6. **Memory Leaks Potential**

#### Issue 6.1: Event handlers not cleaned up
```typescript
// Line 95-193
pc.onicecandidate = (event) => { /* ... */ };
pc.onconnectionstatechange = () => { /* ... */ };
pc.ondatachannel = (event) => { /* ... */ };
```
**Problem**: Event handlers might persist after cleanup if not properly removed.

**Fix**: Set handlers to `null` in cleanup function.

#### Issue 6.2: Signaling message handler not unsubscribed
```typescript
// Line 548-623
signaling.on("message", async (data) => { /* ... */ });
```
**Problem**: Handler might not be unsubscribed on cleanup.

**Fix**: Store unsubscribe function and call it in cleanup.

### 7. **State Synchronization Issues**

#### Issue 7.1: `readyPeers` state might be stale
```typescript
// Line 60, 118, 150, etc.
setReadyPeers((prev) => new Set(prev).add(peerId));
```
**Problem**: Multiple async operations might cause race conditions.

**Fix**: Use functional updates consistently (already doing this, but verify).

---

## 🔧 Recommended Fixes Priority

### High Priority (Breaking/Type Errors)
1. ✅ Fix type errors (RTCSessionDescription null, missing isOnline)
2. ✅ Fix React Hook dependency warnings
3. ✅ Fix React Compiler memoization issues

### Medium Priority (Stability)
4. ✅ Add proper error handling and user notifications
5. ✅ Fix potential race conditions in connection initiation
6. ✅ Add cleanup for event handlers

### Low Priority (Enhancements)
7. ✅ Add retry logic for failed connections
8. ✅ Improve error messages and user feedback
9. ✅ Add connection health monitoring

---

## 📝 Code Quality Notes

### Strengths
- ✅ Good separation of concerns (hooks, contexts, services)
- ✅ Comprehensive logging for debugging
- ✅ Proper use of refs for mutable values
- ✅ Functional state updates to avoid stale closures
- ✅ TypeScript strict mode enabled

### Areas for Improvement
- ⚠️ Some dependency arrays need attention
- ⚠️ Error handling could be more user-friendly
- ⚠️ Some edge cases might not be handled
- ⚠️ Memory cleanup could be more thorough

---

## 🚀 Next Steps

1. **Fix Critical Issues**: Address type errors and dependency warnings
2. **Improve Error Handling**: Add user-facing error messages
3. **Add Tests**: Unit tests for WebRTC hook logic
4. **Performance**: Optimize connection establishment
5. **Features**: 
   - Folder transfer support (partially implemented)
   - Multiple simultaneous transfers
   - Transfer resumption
   - Connection quality indicators

---

## 📚 Related Documentation

- `ARCHITECTURE.md` - Network discovery architecture
- `DEBUGGING.md` - Peer discovery debugging guide
- `SNAPDROP_REFACTOR.md` - Architecture refactor notes
- `PEER_DISCOVERY_FIX.md` - Peer discovery fix details
- `UX_ENHANCEMENTS.md` - UX improvement notes

---

**Last Updated**: 2024-12-19
**Status**: MVP functional, needs bug fixes and improvements

