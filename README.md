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
- A WebSocket signaling server (for WebRTC connection setup)

### Installation

```bash
# Install dependencies
pnpm install

# Start development server
pnpm dev

# Build for production
pnpm build

# Preview production build
pnpm preview
```

### Environment Variables

Create a `.env` file in the root directory:

```env
VITE_SIGNALING_URL=ws://localhost:8080
```

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

## 🚧 Current Status

This is an MVP implementation. The following features are working:

- ✅ Session creation and management
- ✅ WebRTC connection setup
- ✅ File selection (single, multiple, folders)
- ✅ QR code generation
- ✅ Transfer progress UI
- ✅ PWA configuration

**Note**: The receiver-side file reconstruction is simplified in the MVP and may need enhancement for production use.

## 📄 License

MIT

## 🙏 Acknowledgments

Inspired by [Snapdrop](https://snapdrop.net/) and [ToffeeShare](https://toffeeshare.com/).
