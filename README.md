# 🦋 Butterfly Drop

P2P file sharing via WebRTC DataChannels. No cloud, no accounts.

## Architecture

```
┌─────────────┐                    ┌─────────────┐
│  Device A   │                    │  Device B   │
│  (Sender)   │                    │ (Receiver)  │
└──────┬──────┘                    └──────┬──────┘
       │                                  │
       │ 1. WS: session-create            │
       ├──────────────────────────────────┤
       │                                  │
       │ 2. WS: session-join              │
       │◄─────────────────────────────────┤
       │                                  │
       │ 3. WS: SDP offer/answer          │
       │◄─────────────────────────────────┤
       │ 4. WS: ICE candidates            │
       │◄─────────────────────────────────┤
       │                                  │
       │ 5. WebRTC P2P established        │
       │◄═════════════════════════════════►│
       │                                  │
       │ 6. DataChannel: file chunks      │
       │◄═════════════════════════════════►│
       │   (DTLS encrypted, SCTP)         │
       │                                  │
┌──────┴──────┐                    ┌──────┴──────┐
│ Signaling   │                    │ Signaling   │
│   Server    │                    │   Server    │
│  (WebSocket)│                    │  (WebSocket)│
└─────────────┘                    └─────────────┘
     │                                    │
     └────────── SDP/ICE only ───────────┘
     (no file data, ephemeral sessions)
```

**Flow:**
1. Sender creates session → Signaling server generates session ID
2. Receiver joins via session ID → Signaling server links peers
3. SDP offer/answer exchange → WebRTC negotiation
4. ICE candidates exchange → NAT traversal
5. P2P connection established → Direct WebRTC DataChannel
6. File chunks stream → DTLS encrypted, ordered delivery

## Stack

- React 19 + TypeScript + Vite
- Node.js + WebSocket (ws)
- WebRTC DataChannels
- Tailwind + shadcn/ui

## Specs

- **Chunk Size**: 16-64 KB (adaptive)
- **Session**: 12-char URL-safe ID, 30min timeout
- **Data Channel**: Ordered, no retransmission
- **STUN**: Google's public servers
- **Speed**: ~50-100 MB/s (LAN, <10MB), ~20-60 MB/s (LAN, >100MB)
- **Bundle**: 826 KB (254 KB gzipped)

## Roadmap & Future Enhancements

### 🚧 In Progress / Planned

- **Multi-Peer Support**: Send files to multiple peers simultaneously in the same session
  - Select multiple devices at once
  - Parallel file transfers with individual progress tracking
  - Aggregate transfer statistics
  - See [MULTI_PEER_PLAN.md](./MULTI_PEER_PLAN.md) for detailed architecture

### 🔮 Future Enhancements

- **Multiple Data Channel Support**: Use multiple data channels per peer for improved throughput and parallel transfers
- **Resumable Transfers**: Resume interrupted file transfers
- **File Preview**: Preview images, videos, and documents before downloading
- **Folder Structure Preservation**: Better folder transfer with nested directory support
- **Transfer Speed Optimization**: Adaptive chunk sizing based on network conditions
- **Transfer Queue**: Queue multiple file transfers
- **Bandwidth Throttling**: Control upload/download speed limits

## License

MIT
