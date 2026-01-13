# Butterfly Drop

P2P file sharing via WebRTC DataChannels. No cloud, no accounts.

## How It Works

```
Device A ──[WebRTC P2P]── Device B
    │                          │
    └──[Signaling Server]─────┘
    (SDP/ICE only, no file data)
```

Signaling server handles connection setup (SDP/ICE exchange). File data flows directly peer-to-peer via WebRTC DataChannels. Zero file data touches the server.

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

## License

MIT
