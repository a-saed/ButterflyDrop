# Multi-Peer File Transfer Plan

## 🎯 Goal
Enable sending files to multiple peers simultaneously in the same session.

## 📊 Current Architecture

### State (Single Peer)
- `selectedPeerId: string | undefined` - single peer selection
- `sendingToPeer: string | null` - single active transfer
- `sendProgress: TransferProgress | null` - single progress object
- `sendError: string | null` - single error message
- `sendComplete: boolean` - single completion flag

### Transfer Flow
1. User selects files
2. User clicks on ONE peer
3. `sendFiles(files, dataChannel, peerId, peerName)` sends to that peer
4. Progress tracked for single peer

## 🔄 Proposed Architecture

### State Changes (Multi-Peer)

#### 1. Selection State
```typescript
// Change from single to multiple
selectedPeerIds: Set<string>  // Instead of selectedPeerId: string
```

#### 2. Transfer State
```typescript
interface MultiPeerTransferState {
  // Active transfers per peer
  activeTransfers: Map<string, {
    peerId: string;
    peerName: string;
    progress: TransferProgress | null;
    status: 'sending' | 'complete' | 'error';
    error?: string;
  }>;
  
  // Aggregate state
  totalPeers: number;
  completedPeers: number;
  failedPeers: number;
  overallProgress: number; // 0-100
}
```

#### 3. Hook API Changes
```typescript
// Current
sendFiles(files, dataChannel, peerId, peerName)

// Proposed
sendFilesToPeers(
  files: File[],
  peerChannels: Map<string, {
    channel: RTCDataChannel;
    name: string;
  }>
): Promise<Map<string, { success: boolean; error?: string }>>
```

## 🏗️ Implementation Plan

### Phase 1: State Management (useFileTransfer.ts)

#### 1.1 Update Transfer State
- Change `sendingToPeer` → `activeTransfers: Map<peerId, TransferState>`
- Track progress per peer
- Track errors per peer
- Track completion per peer

#### 1.2 Modify `sendFiles` Function
```typescript
const sendFilesToPeers = async (
  files: File[],
  peerChannels: Map<string, { channel: RTCDataChannel; name: string }>
) => {
  // Validate all channels
  for (const [peerId, { channel }] of peerChannels) {
    if (channel.readyState !== "open") {
      throw new Error(`Channel not open for ${peerId}`);
    }
  }

  // Initialize state for all peers
  const transferStates = new Map();
  peerChannels.forEach(({ name }, peerId) => {
    transferStates.set(peerId, {
      peerId,
      peerName: name,
      progress: null,
      status: 'sending' as const,
    });
  });

  setState(prev => ({
    ...prev,
    activeTransfers: transferStates,
  }));

  // Send to all peers in parallel
  const results = await Promise.allSettled(
    Array.from(peerChannels.entries()).map(async ([peerId, { channel, name }]) => {
      return sendFilesToSinglePeer(files, channel, peerId, name);
    })
  );

  // Update state with results
  // Handle success/error per peer
};
```

#### 1.3 Extract Single-Peer Logic
- Create `sendFilesToSinglePeer()` - current `sendFiles` logic
- Reuse for parallel execution
- Update progress per peer independently

### Phase 2: UI Changes (App.tsx)

#### 2.1 Selection State
```typescript
// Change from
const [selectedPeerId, setSelectedPeerId] = useState<string>();

// To
const [selectedPeerIds, setSelectedPeerIds] = useState<Set<string>>(new Set());
```

#### 2.2 Selection Handlers
```typescript
const handlePeerToggle = (peerId: string) => {
  setSelectedPeerIds(prev => {
    const next = new Set(prev);
    if (next.has(peerId)) {
      next.delete(peerId);
    } else {
      next.add(peerId);
    }
    return next;
  });
};

const handleSelectAll = () => {
  const allReadyPeerIds = peers
    .filter(p => isPeerReady(p.id))
    .map(p => p.id);
  setSelectedPeerIds(new Set(allReadyPeerIds));
};
```

#### 2.3 Send Handler
```typescript
const handleSend = async () => {
  if (selectedFiles.length === 0) return;
  if (selectedPeerIds.size === 0) {
    toast.error("No peers selected");
    return;
  }

  // Collect data channels for selected peers
  const peerChannels = new Map();
  for (const peerId of selectedPeerIds) {
    if (!isPeerReady(peerId)) continue;
    
    const channel = getDataChannelForPeer(peerId);
    if (channel?.readyState === "open") {
      const peer = peers.find(p => p.id === peerId);
      peerChannels.set(peerId, {
        channel,
        name: peer?.name || "Unknown",
      });
    }
  }

  if (peerChannels.size === 0) {
    toast.error("No ready peers selected");
    return;
  }

  await sendFilesToPeers(selectedFiles, peerChannels);
};
```

### Phase 3: UI Components

#### 3.1 PeerNetwork Component
- Support multi-select (click to toggle)
- Visual indication: selected vs not selected
- Show "Select All" button when files are ready
- Highlight ready peers differently

```typescript
interface PeerNetworkProps {
  peers: Peer[];
  selectedPeerIds: Set<string>;  // Changed
  onPeerToggle: (peerId: string) => void;  // Changed
  onSelectAll?: () => void;  // New
  hasFiles?: boolean;
  readyPeers?: string[];
}
```

#### 3.2 SendProgressPanel Component
- Show progress for each peer
- List or accordion view
- Aggregate progress indicator
- Individual success/error states

```typescript
interface SendProgressPanelProps {
  activeTransfers: Map<string, PeerTransferState>;
  onReset: () => void;
}

// Display:
// - Overall: "Sending to 3 peers (2/3 complete)"
// - Per-peer: Progress bars for each peer
// - Errors: Show which peers failed
```

#### 3.3 Send Button
```typescript
// Current
"Send X files to {peerName}"

// New
"Send X files to {selectedPeerIds.size} peer{plural}"
// Or if only one: "Send X files to {peerName}"
```

### Phase 4: Progress Tracking

#### 4.1 Per-Peer Progress Updates
- Each `sendFilesToSinglePeer` updates its own progress
- State updates use functional updates to merge per-peer progress
- UI subscribes to `activeTransfers` map

#### 4.2 Aggregate Progress
```typescript
const overallProgress = useMemo(() => {
  let totalBytes = 0;
  let transferredBytes = 0;
  
  activeTransfers.forEach(({ progress }) => {
    if (progress) {
      totalBytes += progress.totalBytes;
      transferredBytes += progress.bytesTransferred;
    }
  });
  
  return totalBytes > 0 ? (transferredBytes / totalBytes) * 100 : 0;
}, [activeTransfers]);
```

## 🎨 UX Considerations

### Selection Modes
1. **Single Select** (current): Click to select one peer
2. **Multi-Select** (new): Click to toggle peers on/off
3. **Select All**: Button to select all ready peers

### Visual Feedback
- Selected peers: Highlighted border/background
- Ready peers: Green indicator
- Sending to peer: Animated indicator
- Completed peer: Checkmark
- Failed peer: Error icon

### Error Handling
- If one peer fails, others continue
- Show which peers succeeded/failed
- Allow retry for failed peers
- Don't block UI for other transfers

## 📝 Implementation Steps

### Step 1: Update Types
- [ ] Add `MultiPeerTransferState` interface
- [ ] Update `TransferState` in `useFileTransfer.ts`
- [ ] Update component prop types

### Step 2: Modify useFileTransfer Hook
- [ ] Change state from single peer to Map<peerId, state>
- [ ] Extract `sendFilesToSinglePeer` function
- [ ] Create `sendFilesToPeers` wrapper
- [ ] Update progress tracking to be per-peer
- [ ] Update error handling to be per-peer

### Step 3: Update App.tsx
- [ ] Change `selectedPeerId` → `selectedPeerIds: Set<string>`
- [ ] Update `handlePeerSelect` → `handlePeerToggle`
- [ ] Add `handleSelectAll` function
- [ ] Update `handleSend` to collect multiple channels
- [ ] Update `canSend` logic

### Step 4: Update PeerNetwork Component
- [ ] Support `selectedPeerIds: Set<string>`
- [ ] Update `onPeerSelect` → `onPeerToggle`
- [ ] Add visual indication for selected peers
- [ ] Add "Select All" button (optional)

### Step 5: Update SendProgressPanel Component
- [ ] Accept `activeTransfers: Map<string, PeerTransferState>`
- [ ] Display per-peer progress
- [ ] Show aggregate progress
- [ ] Handle per-peer errors

### Step 6: Testing
- [ ] Test single peer (should work as before)
- [ ] Test multiple peers simultaneously
- [ ] Test partial failures (one peer fails)
- [ ] Test progress updates per peer
- [ ] Test UI responsiveness during multi-transfer

## ⚠️ Potential Challenges

1. **Memory**: Multiple parallel transfers might use more memory
   - Solution: Keep chunk size reasonable, limit concurrent transfers if needed

2. **Network Bandwidth**: Sending to many peers simultaneously
   - Solution: Adaptive flow control already handles this per-channel

3. **UI Complexity**: Showing progress for many peers
   - Solution: Use accordion/collapsible list, show summary by default

4. **Error Recovery**: What if some peers fail?
   - Solution: Continue with successful peers, show errors per-peer, allow retry

5. **State Management**: Complex state updates
   - Solution: Use functional updates, Map for per-peer state

## 🚀 Future Enhancements

1. **Batch Operations**: Select all ready peers automatically
2. **Transfer Queue**: Queue transfers if too many peers
3. **Priority**: Prioritize certain peers
4. **Resume**: Resume failed transfers
5. **Cancel**: Cancel individual peer transfers

## 📊 Complexity Assessment

- **Difficulty**: Medium-High
- **Time Estimate**: 4-6 hours
- **Risk**: Medium (affects core transfer logic)
- **Breaking Changes**: Yes (API changes, but backward compatible with single peer)

## ✅ Backward Compatibility

- Single peer selection should still work
- If only one peer selected, behavior identical to current
- UI can gracefully handle both single and multi-select


