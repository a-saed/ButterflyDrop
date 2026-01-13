# 🚀 Large File Transfer Strategy for Butterfly Drop

## 📊 Current Problem Analysis

### Issues with Current Implementation:
1. **Too Slow**: 200MB file takes too long to transfer
2. **Overly Conservative**: Waiting for `bufferedAmount === 0` before each chunk
3. **Sequential Only**: One chunk at a time, no parallelism
4. **Memory Concerns**: Loading entire file into memory before sending

### Performance Bottlenecks:
- **Current**: ~4-5ms per chunk (wait buffer + delay)
- **For 200MB file**: ~12,500 chunks × 5ms = **62+ seconds minimum** (not counting network time)
- **Realistic**: With network overhead, **2-5 minutes** for 200MB

---

## 🎯 Target Performance Goals

- **Small files (<10MB)**: < 5 seconds
- **Medium files (10-50MB)**: < 30 seconds  
- **Large files (50-200MB)**: < 2 minutes
- **Very large files (200MB+)**: < 5 minutes

**Target throughput**: 2-5 MB/s on good WiFi, 1-2 MB/s on mobile

---

## 🏗️ Proposed Architecture: Multi-Channel Adaptive Transfer

### Core Strategy: **Parallel Data Channels + Adaptive Flow Control**

Instead of one slow sequential channel, use **multiple parallel data channels** with intelligent flow control.

---

## 📐 Architecture Design

### 1. **Multi-Channel Transfer System**

```
┌─────────────────────────────────────────────────────────┐
│                    Sender                                │
├─────────────────────────────────────────────────────────┤
│  File (200MB)                                           │
│    ↓                                                     │
│  Chunk Queue Manager                                    │
│    ├─ Channel 0: chunks 0, 4, 8, 12...                 │
│    ├─ Channel 1: chunks 1, 5, 9, 13...                 │
│    ├─ Channel 2: chunks 2, 6, 10, 14...                 │
│    └─ Channel 3: chunks 3, 7, 11, 15...                 │
│                                                          │
│  Flow Controller (per channel)                          │
│    ├─ Monitor bufferedAmount                           │
│    ├─ Adaptive send rate                               │
│    └─ Backpressure handling                            │
└─────────────────────────────────────────────────────────┘
                    ↓ WebRTC P2P
┌─────────────────────────────────────────────────────────┐
│                    Receiver                             │
├─────────────────────────────────────────────────────────┤
│  Channel 0 → Chunk Reassembler                         │
│  Channel 1 → Chunk Reassembler                         │
│  Channel 2 → Chunk Reassembler                         │
│  Channel 3 → Chunk Reassembler                         │
│                                                          │
│  Sequential Writer                                      │
│    └─ Write chunks in order (0,1,2,3...)               │
└─────────────────────────────────────────────────────────┘
```

### 2. **Channel Configuration**

**Number of Channels**: Adaptive based on file size
- **< 10MB**: 1 channel (current approach)
- **10-50MB**: 2 channels
- **50-200MB**: 4 channels  
- **200MB+**: 8 channels (max)

**Channel Settings**:
```typescript
{
  ordered: true,           // Maintain order per channel
  maxRetransmits: undefined, // Reliable mode
  // Each channel handles its own sequence
}
```

### 3. **Chunk Distribution Strategy**

**Round-Robin Distribution**:
```
File: [chunk0, chunk1, chunk2, chunk3, chunk4, chunk5, ...]
       ↓       ↓       ↓       ↓       ↓       ↓
      Ch0     Ch1     Ch2     Ch3     Ch0     Ch1
```

**Benefits**:
- Parallel sending (4x speedup with 4 channels)
- Load balancing across channels
- If one channel slows, others continue

---

## ⚡ Flow Control: Adaptive Rate Limiting

### Current Problem:
- Waiting for `bufferedAmount === 0` is too conservative
- Creates artificial bottleneck

### New Approach: **Adaptive Window-Based Flow Control**

```typescript
interface ChannelState {
  bufferedAmount: number;
  lastSentTime: number;
  sendRate: number;        // bytes/second
  targetRate: number;      // adaptive target
  windowSize: number;      // how many chunks to send before checking
}

// Adaptive algorithm:
1. Start with windowSize = 4 chunks
2. Send windowSize chunks rapidly
3. Check bufferedAmount
4. If buffer < threshold: increase windowSize (faster)
5. If buffer > threshold: decrease windowSize (slower)
6. Repeat
```

### Buffer Thresholds:
```typescript
const BUFFER_LOW = 64 * 1024;   // 64 KB - safe to send
const BUFFER_MEDIUM = 256 * 1024; // 256 KB - slow down
const BUFFER_HIGH = 512 * 1024;   // 512 KB - pause
```

### Adaptive Rate Algorithm:
```typescript
function calculateWindowSize(channelState: ChannelState): number {
  const bufferRatio = channelState.bufferedAmount / BUFFER_HIGH;
  
  if (bufferRatio < 0.25) {
    // Buffer is low - send aggressively
    return Math.min(channelState.windowSize * 1.5, 16);
  } else if (bufferRatio < 0.5) {
    // Buffer is medium - maintain current rate
    return channelState.windowSize;
  } else {
    // Buffer is high - slow down
    return Math.max(channelState.windowSize * 0.7, 1);
  }
}
```

---

## 📦 Chunk Size Optimization

### Current: 16 KB (fixed)
### New: **Adaptive Chunk Size**

```typescript
function getOptimalChunkSize(fileSize: number, networkSpeed?: number): number {
  // Base chunk size
  let chunkSize = 16 * 1024; // 16 KB default
  
  // For very large files, use larger chunks (less overhead)
  if (fileSize > 100 * 1024 * 1024) { // > 100 MB
    chunkSize = 32 * 1024; // 32 KB
  }
  
  // For huge files, use even larger chunks
  if (fileSize > 500 * 1024 * 1024) { // > 500 MB
    chunkSize = 64 * 1024; // 64 KB (max safe size)
  }
  
  return chunkSize;
}
```

**Rationale**:
- Smaller chunks = more overhead (headers, processing)
- Larger chunks = better throughput but more memory
- Balance based on file size

---

## 🔄 Chunk Reassembly Strategy

### Challenge: Multiple channels send chunks out of order

### Solution: **Priority Queue with Sequence Tracking**

```typescript
interface ChunkSlot {
  sequenceNumber: number;
  channelId: number;
  data: ArrayBuffer | null;
  received: boolean;
}

class ChunkReassembler {
  private slots: Map<number, ChunkSlot> = new Map();
  private nextExpectedSeq = 0;
  
  receiveChunk(seq: number, channelId: number, data: ArrayBuffer) {
    // Store chunk
    this.slots.set(seq, { seq, channelId, data, received: true });
    
    // Try to write sequential chunks
    this.writeSequentialChunks();
  }
  
  private writeSequentialChunks() {
    while (this.slots.has(this.nextExpectedSeq)) {
      const slot = this.slots.get(this.nextExpectedSeq)!;
      if (slot.received && slot.data) {
        // Write chunk to file
        this.writeChunk(slot.data);
        this.slots.delete(this.nextExpectedSeq);
        this.nextExpectedSeq++;
      } else {
        break; // Missing chunk, wait
      }
    }
  }
}
```

---

## 💾 Memory Management

### Current Issue: Loading entire file into memory

### Solution: **Streaming with FileReader API**

```typescript
// Instead of: await readFileInChunks(file) - loads all chunks
// Use: Streaming FileReader

async function* streamFileChunks(
  file: File,
  chunkSize: number
): AsyncGenerator<ArrayBuffer> {
  let offset = 0;
  
  while (offset < file.size) {
    const chunk = file.slice(offset, offset + chunkSize);
    const buffer = await chunk.arrayBuffer();
    yield buffer;
    offset += chunkSize;
    
    // Yield control to prevent blocking
    await new Promise(resolve => setTimeout(resolve, 0));
  }
}
```

**Benefits**:
- Only one chunk in memory at a time
- Can handle files larger than available RAM
- Better for mobile devices

---

## 📊 Progress Tracking

### Real-Time Progress Calculation:

```typescript
interface TransferProgress {
  bytesTransferred: number;
  totalBytes: number;
  percentage: number;
  speed: number;           // bytes/second
  eta: number;             // seconds
  channelsActive: number;  // how many channels are sending
  averageChunkTime: number; // ms per chunk
}

// Calculate from all channels
function calculateProgress(channels: ChannelState[]): TransferProgress {
  const totalBytes = channels.reduce((sum, ch) => sum + ch.bytesSent, 0);
  const elapsed = Date.now() - startTime;
  const speed = totalBytes / (elapsed / 1000);
  const remaining = totalBytes - bytesTransferred;
  const eta = speed > 0 ? remaining / speed : 0;
  
  return {
    bytesTransferred: totalBytes,
    totalBytes: fileSize,
    percentage: (totalBytes / fileSize) * 100,
    speed,
    eta,
    channelsActive: channels.filter(ch => ch.isActive).length,
    averageChunkTime: elapsed / totalChunksSent,
  };
}
```

---

## 🎛️ Implementation Phases

### Phase 1: **Single Channel Optimization** (Quick Win)
**Goal**: Improve current implementation without major refactor

1. ✅ Remove `maxRetransmits: 0` (DONE)
2. Implement adaptive window-based flow control
3. Increase chunk size for large files (32-64 KB)
4. Better buffer management (don't wait for 0)

**Expected improvement**: 2-3x faster

### Phase 2: **Dual Channel** (Medium Effort)
**Goal**: Add second parallel channel

1. Create second data channel
2. Implement round-robin chunk distribution
3. Add chunk reassembly logic
4. Test with 50-100MB files

**Expected improvement**: 1.5-2x faster than Phase 1

### Phase 3: **Multi-Channel System** (Full Implementation)
**Goal**: Complete multi-channel system

1. Dynamic channel creation (2-8 channels)
2. Adaptive channel count based on file size
3. Advanced flow control per channel
4. Comprehensive error handling
5. Memory optimization (streaming)

**Expected improvement**: 4-8x faster than current

---

## 🔧 Technical Implementation Details

### Channel Creation:

```typescript
async function createTransferChannels(
  peerConnection: RTCPeerConnection,
  fileSize: number
): Promise<RTCDataChannel[]> {
  const channelCount = getOptimalChannelCount(fileSize);
  const channels: RTCDataChannel[] = [];
  
  for (let i = 0; i < channelCount; i++) {
    const channel = peerConnection.createDataChannel(
      `file-transfer-${i}`,
      { ordered: true }
    );
    channel.binaryType = "arraybuffer";
    channels.push(channel);
  }
  
  // Wait for all channels to open
  await Promise.all(
    channels.map(ch => new Promise(resolve => {
      if (ch.readyState === "open") resolve(ch);
      else ch.onopen = () => resolve(ch);
    }))
  );
  
  return channels;
}
```

### Adaptive Flow Control:

```typescript
class AdaptiveFlowController {
  private windowSize = 4;
  private readonly BUFFER_LOW = 64 * 1024;
  private readonly BUFFER_HIGH = 512 * 1024;
  
  async sendChunkWindow(
    channel: RTCDataChannel,
    chunks: ArrayBuffer[]
  ): Promise<void> {
    // Send windowSize chunks
    for (let i = 0; i < this.windowSize && i < chunks.length; i++) {
      channel.send(chunks[i]);
    }
    
    // Wait for buffer to drain
    await this.waitForBufferDrain(channel);
    
    // Adapt window size
    this.adaptWindowSize(channel);
  }
  
  private adaptWindowSize(channel: RTCDataChannel) {
    const ratio = channel.bufferedAmount / this.BUFFER_HIGH;
    
    if (ratio < 0.25) {
      this.windowSize = Math.min(this.windowSize * 1.5, 16);
    } else if (ratio > 0.75) {
      this.windowSize = Math.max(this.windowSize * 0.7, 1);
    }
  }
  
  private async waitForBufferDrain(channel: RTCDataChannel) {
    if (channel.bufferedAmount < this.BUFFER_LOW) return;
    
    return new Promise<void>(resolve => {
      channel.bufferedAmountLowThreshold = this.BUFFER_LOW;
      const handler = () => {
        channel.removeEventListener('bufferedamountlow', handler);
        resolve();
      };
      channel.addEventListener('bufferedamountlow', handler);
    });
  }
}
```

---

## 🧪 Testing Strategy

### Test Cases:

1. **Small files (<10MB)**: Should use 1 channel, complete in <5s
2. **Medium files (10-50MB)**: Should use 2 channels, complete in <30s
3. **Large files (50-200MB)**: Should use 4 channels, complete in <2min
4. **Very large files (200MB+)**: Should use 8 channels, complete in <5min

### Network Conditions:
- Good WiFi (fast, stable)
- Poor WiFi (slow, unstable)
- Mobile 4G/5G
- Cross-network (different ISPs)

### Metrics to Track:
- Total transfer time
- Average throughput (MB/s)
- Chunk loss rate
- Memory usage
- CPU usage

---

## 🚨 Error Handling & Edge Cases

### Channel Failure:
- If one channel fails, redistribute its chunks to other channels
- Retry failed chunks on different channel

### Network Interruption:
- Detect connection loss
- Resume from last successful chunk
- Request missing chunks

### Memory Pressure:
- Monitor memory usage
- Reduce channel count if needed
- Pause sending if memory is low

---

## 📈 Performance Expectations

### Current (Sequential, Conservative):
- **200MB file**: ~5-10 minutes
- **Throughput**: ~0.3-0.7 MB/s

### Phase 1 (Optimized Single Channel):
- **200MB file**: ~2-3 minutes
- **Throughput**: ~1-2 MB/s

### Phase 2 (Dual Channel):
- **200MB file**: ~1-2 minutes
- **Throughput**: ~2-4 MB/s

### Phase 3 (Multi-Channel):
- **200MB file**: ~30-60 seconds
- **Throughput**: ~4-8 MB/s

---

## 🎯 Recommended Implementation Order

1. **Start with Phase 1** (quick wins, low risk)
   - Adaptive flow control
   - Better chunk sizing
   - Improved buffer management
   
2. **Validate Phase 1** (test thoroughly)
   - Ensure reliability maintained
   - Measure performance gains
   
3. **Implement Phase 2** (if Phase 1 isn't enough)
   - Add second channel
   - Implement reassembly
   
4. **Scale to Phase 3** (if needed for very large files)
   - Full multi-channel system
   - Advanced optimizations

---

## 📝 Notes

- **Browser Limits**: Some browsers limit number of data channels (typically 256, but practical limit is ~16)
- **Mobile Considerations**: Mobile devices may have stricter memory limits
- **Network Variability**: Adaptive algorithms must handle varying network conditions
- **User Experience**: Progress updates should be smooth, not janky

---

## 🔗 References

- [WebRTC Data Channels Guide](https://web.dev/articles/webrtc-datachannels)
- [WebRTC File Transfer Sample](https://webrtc.github.io/samples/src/content/datachannel/filetransfer/)
- [WebTorrent Architecture](https://github.com/webtorrent/webtorrent) - Multi-channel P2P file sharing
- [Snapdrop Implementation](https://github.com/RobinLinus/snapdrop) - Single channel but optimized

---

## 🎯 Reality Check: What Apps Actually Use

### **Single Channel (Most Common)**:
- **Snapdrop** - Uses ONE data channel with optimized flow control
- **ShareDrop** - Single channel approach
- **Most simple P2P apps** - Keep it simple, one channel

**Why?**:
- Simpler to implement and debug
- Less overhead
- Easier to maintain
- Good enough for most use cases

### **Multi-Channel (Advanced)**:
- **WebTorrent** - Uses multiple channels (it's a torrent client, needs parallelism)
- **Resilio Sync** - Uses multiple channels (enterprise-grade sync)
- **Complex P2P systems** - When you need maximum throughput

**Why?**:
- More complex to implement
- Harder to debug
- More overhead
- Only needed for very large files or maximum performance

### **Our Recommendation**:

**Start with Phase 1 (Optimized Single Channel)** - This is what Snapdrop does:
- ✅ Adaptive flow control (don't wait for buffer=0)
- ✅ Larger chunks for large files (32-64 KB)
- ✅ Better buffer management
- ✅ Streaming file reading

**Expected**: 2-3x faster, which should make 200MB files transfer in ~2-3 minutes (acceptable for most users)

**Only move to multi-channel IF**:
- Users complain about speed even after Phase 1
- You're targeting files >500MB regularly
- You need enterprise-grade performance

---

## 💡 Honest Assessment

**Multi-channel is NOT the "best" solution** - it's the "most complex" solution.

**The REAL best solution** for most apps is:
1. **Single optimized channel** (like Snapdrop)
2. **Good flow control** (adaptive, not conservative)
3. **Proper chunk sizing** (larger for large files)
4. **Reliable mode** (no maxRetransmits: 0)

This gives you **80% of the performance with 20% of the complexity**.

**Multi-channel is only worth it if**:
- You're building a torrent client (WebTorrent)
- You're building enterprise sync (Resilio)
- You're optimizing for files >1GB regularly

---

**Next Steps**: Let's implement Phase 1 (optimized single channel) first - it's what Snapdrop uses and it works great!

