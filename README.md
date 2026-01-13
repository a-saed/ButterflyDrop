# 🦋 Butterfly Drop

**Let your files fly.**

A cross-platform PWA web app that enables fast, private, peer-to-peer file and folder sharing using WebRTC DataChannels.

## ✨ Features

- 🚀 **Fast & Direct** - Files transfer directly between devices, no cloud storage
- 🔒 **Private & Secure** - End-to-end encrypted via WebRTC DTLS
- 📁 **File & Folder Support** - Transfer single files, multiple files, or entire folders
- 📱 **PWA Ready** - Installable on desktop and mobile devices
- 🎨 **Beautiful UI** - Modern, responsive design with delightful animations
- 🔗 **Easy Sharing** - Share via link or QR code

## 🛠 Tech Stack

- **React 18+** with TypeScript
- **Vite** for build tooling
- **Tailwind CSS** + **shadcn/ui** for styling
- **WebRTC** for peer-to-peer connections
- **PWA** support with service workers

## 🚀 Getting Started

### Prerequisites

- Node.js 18+ and pnpm
- A WebSocket signaling server (included in `server/` folder)

### Local Development

```bash
# Install dependencies
pnpm install

# Install server dependencies
cd server && pnpm install && cd ..

# Start signaling server (in one terminal)
cd server && pnpm dev

# Start frontend (in another terminal)
pnpm dev
```

### Environment Variables

For local development, create a `.env.local` file:

```env
VITE_SIGNALING_URL=ws://localhost:8080
```

### Production Build

```bash
# Build frontend
pnpm build

# Build server
cd server && pnpm build
```

## 🚀 Deployment

See [DEPLOYMENT.md](./DEPLOYMENT.md) for detailed deployment instructions.

**Quick Start**: Deploy backend to **Render** and frontend to **Vercel** (both free tiers available).

## 📁 Project Structure

```
src/
├── components/          # React components
│   ├── ui/              # shadcn/ui components
│   ├── transfer/        # Transfer-related components
│   └── connection/      # Connection status components
├── hooks/               # Custom React hooks
│   ├── useWebRTC.ts     # WebRTC connection logic
│   ├── useFileTransfer.ts
│   └── useSession.ts
├── lib/                 # Utilities and helpers
│   ├── webrtc/          # WebRTC utilities
│   ├── fileUtils.ts     # File handling utilities
│   └── sessionUtils.ts  # Session ID generation
├── types/               # TypeScript type definitions
├── contexts/            # React contexts
└── services/            # Service layer (signaling)
```

## 🔗 How It Works

1. **Sender** opens Butterfly Drop and creates a session
2. A shareable link and QR code are generated
3. **Receiver** opens the link on another device
4. WebRTC connection is established via signaling server
5. Files are transferred directly peer-to-peer
6. Session expires automatically after completion

## 🎯 Core Principles

- ✅ No user accounts
- ✅ No cloud storage
- ✅ No file persistence on servers
- ✅ Session-based, ephemeral sharing
- ✅ End-to-end encrypted (WebRTC default)
- ✅ Extremely simple UX

## 📝 Development

### Code Style

- TypeScript strict mode enabled
- Functional components only
- Custom hooks for WebRTC logic
- shadcn/ui for UI components
- Tailwind CSS for styling

### Key Implementation Details

- **Chunk Size**: 256 KB (262144 bytes)
- **Session ID**: 12-character URL-safe random string
- **Data Channel**: Ordered, no retransmission for file chunks
- **STUN Servers**: Google's public STUN servers (configurable)

## ✨ Features

- ✅ **Session Management** - Create and join sessions via link or QR code
- ✅ **WebRTC P2P** - Direct device-to-device file transfer
- ✅ **File & Folder Support** - Transfer single files, multiple files, or entire folders
- ✅ **Real-time Progress** - Live transfer progress with speed indicators
- ✅ **PWA Ready** - Installable on desktop and mobile
- ✅ **Beautiful UI** - Modern design with butterfly-themed animations
- ✅ **Cross-platform** - Works on desktop and mobile browsers

## 📄 License

MIT

## 🙏 Acknowledgments

Inspired by [Snapdrop](https://snapdrop.net/) and [ToffeeShare](https://toffeeshare.com/).
