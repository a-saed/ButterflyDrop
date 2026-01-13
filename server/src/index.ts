import { WebSocketServer, WebSocket } from "ws";
import { createServer, type IncomingMessage, type ServerResponse } from "http";
import type {
  SignalingMessage,
  Session,
  PeerConnection,
  PeerInfo,
} from "./types.js";

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 8080;
const SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes
const NODE_ENV = process.env.NODE_ENV || "development";

// CORS configuration for production
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",")
  : ["http://localhost:5173", "http://localhost:3000"];

// In-memory session storage
const sessions = new Map<string, Session>();

// Cleanup old sessions periodically
setInterval(() => {
  const now = Date.now();
  for (const [sessionId, session] of sessions.entries()) {
    if (now - session.lastActivity > SESSION_TIMEOUT) {
      console.log(`Cleaning up expired session: ${sessionId}`);
      if (session.sender) session.sender.close();
      if (session.receiver) session.receiver.close();
      sessions.delete(sessionId);
    }
  }
}, 60000); // Check every minute

function updateSessionActivity(sessionId: string) {
  const session = sessions.get(sessionId);
  if (session) {
    session.lastActivity = Date.now();
  }
}

/**
 * Get list of peers in a network
 */
function getPeerList(sessionId: string): PeerInfo[] {
  const session = sessions.get(sessionId);
  if (!session || !session.peers) {
    return [];
  }

  return Array.from(session.peers.values()).map((peer) => ({
    id: peer.peerId,
    name: peer.peerName,
    deviceType: peer.deviceType,
    isOnline: true,
  }));
}

/**
 * Broadcast peer list to all peers in a network
 */
function broadcastPeerList(sessionId: string) {
  const session = sessions.get(sessionId);
  if (!session || !session.peers) {
    console.log(
      `Cannot broadcast peer list: session ${sessionId} or peers not found`,
    );
    return;
  }

  const peerList = getPeerList(sessionId);
  console.log(
    `Broadcasting peer list for session ${sessionId}: ${peerList.length} peers to ${session.peers.size} connections`,
  );

  let sentCount = 0;
  // Send to all peers in network
  session.peers.forEach((peer) => {
    if (peer.ws.readyState === WebSocket.OPEN) {
      peer.ws.send(
        JSON.stringify({
          type: "peer-list",
          sessionId,
          peers: peerList,
        }),
      );
      sentCount++;
    } else {
      console.log(
        `Peer ${peer.peerId} connection not open (state: ${peer.ws.readyState})`,
      );
    }
  });

  console.log(`Broadcasted peer list to ${sentCount} peers`);
}

function handleMessage(ws: WebSocket, message: SignalingMessage) {
  const { type, sessionId, data } = message;

  console.log(`Received message: ${type}`, {
    sessionId,
    peerId: message.peerId,
  });

  // Update session activity
  if (sessionId) {
    updateSessionActivity(sessionId);
  }

  switch (type) {
    case "session-create":
    case "session-join": {
      // Modern P2P approach: no distinction between sender/receiver
      // All peers are equal and can send/receive files
      if (!sessionId) {
        console.error("Session ID missing");
        ws.send(
          JSON.stringify({
            type: "error",
            sessionId: "",
            error: "Session ID required",
          }),
        );
        return;
      }

      const peerId = (message.peerId || `peer-${Date.now()}`) as string;
      const peerName = (message.peerName || "Unknown Device") as string;
      const deviceType = (message.deviceType || "desktop") as string;

      // Get or create session
      let session = sessions.get(sessionId);
      if (!session) {
        console.log(`Creating new session: ${sessionId}`);
        session = {
          id: sessionId,
          createdAt: Date.now(),
          lastActivity: Date.now(),
          peers: new Map(),
        };
        sessions.set(sessionId, session);
      }

      // Check if peer already exists in this session
      if (session.peers?.has(peerId)) {
        console.log(`⚠️ Peer ${peerId} already exists in session ${sessionId}`);
        console.log(`   Checking if it's a reconnection or duplicate...`);

        const existingPeer = session.peers.get(peerId);
        if (existingPeer) {
          // Check if it's the SAME connection (duplicate message)
          if (existingPeer.ws === ws) {
            console.log(
              `   ℹ️ Same connection, ignoring duplicate join request`,
            );
            // Don't broadcast, just send confirmation
            ws.send(
              JSON.stringify({
                type: type,
                sessionId,
                peers: getPeerList(sessionId),
                success: true,
              }),
            );
            return; // Exit early
          } else {
            // Different connection - it's a reconnection
            console.log(`   🔄 Different connection, treating as reconnection`);
            console.log(`   Closing old connection and updating...`);
            try {
              existingPeer.ws.close();
            } catch (e) {
              console.log(`   Failed to close old connection:`, e);
            }
            // Update with new connection
            existingPeer.ws = ws;
            existingPeer.joinedAt = Date.now();
            console.log(
              `   ✅ Peer ${peerName} (${peerId}) reconnected to session ${sessionId}`,
            );
          }
        }
      } else {
        // New peer - add to network
        const peerConn: PeerConnection = {
          ws,
          peerId,
          peerName,
          deviceType,
          joinedAt: Date.now(),
        };

        if (!session.peers) {
          session.peers = new Map();
        }
        session.peers.set(peerId, peerConn);
        console.log(
          `✅ Peer ${peerName} (${peerId}) joined session ${sessionId}`,
        );
      }

      // Get current peer list (will exclude self automatically)
      const peerList = getPeerList(sessionId);
      console.log(
        `Session ${sessionId} now has ${session.peers.size} total peers`,
      );
      console.log(
        `Peer names: ${Array.from(session.peers.values())
          .map((p) => p.peerName)
          .join(", ")}`,
      );

      // Broadcast updated peer list to ALL peers in session
      broadcastPeerList(sessionId);

      // Send confirmation to joining peer with current peer list
      ws.send(
        JSON.stringify({
          type: type, // Echo back the original type
          sessionId,
          peers: peerList,
          success: true,
        }),
      );

      break;
    }

    case "offer": {
      // P2P: Forward offer to target peer
      if (!sessionId) {
        console.error("Session ID missing in offer");
        ws.send(
          JSON.stringify({
            type: "error",
            sessionId: "",
            error: "Session ID required",
          }),
        );
        return;
      }

      const targetPeerId = message.peerId;
      if (!targetPeerId) {
        console.error("Target peer ID missing in offer");
        ws.send(
          JSON.stringify({
            type: "error",
            sessionId,
            error: "Target peer ID required",
          }),
        );
        return;
      }

      const session = sessions.get(sessionId);
      if (!session || !session.peers) {
        ws.send(
          JSON.stringify({
            type: "error",
            sessionId,
            error: "Session not found",
          }),
        );
        return;
      }

      const targetPeer = session.peers.get(targetPeerId);
      if (!targetPeer) {
        ws.send(
          JSON.stringify({
            type: "error",
            sessionId,
            error: "Target peer not found",
          }),
        );
        return;
      }

      // Find sender peer ID
      let senderPeerId: string | undefined;
      session.peers.forEach((peer) => {
        if (peer.ws === ws) {
          senderPeerId = peer.peerId;
        }
      });

      console.log(
        `Forwarding offer from ${senderPeerId} to peer ${targetPeerId} in session ${sessionId}`,
      );
      targetPeer.ws.send(
        JSON.stringify({
          type: "offer",
          sessionId,
          peerId: senderPeerId, // Include sender ID so client knows who sent the offer
          data,
        }),
      );
      break;
    }

    case "answer": {
      // P2P: Forward answer back to the peer who sent the offer
      if (!sessionId) {
        console.error("Session ID missing in answer");
        ws.send(
          JSON.stringify({
            type: "error",
            sessionId: "",
            error: "Session ID required",
          }),
        );
        return;
      }

      const session = sessions.get(sessionId);
      if (!session || !session.peers) {
        ws.send(
          JSON.stringify({
            type: "error",
            sessionId,
            error: "Session not found",
          }),
        );
        return;
      }

      // Answer should go to the target peer ID specified in the message
      const targetPeerId = message.peerId;
      if (!targetPeerId) {
        console.error("Target peer ID missing in answer");
        ws.send(
          JSON.stringify({
            type: "error",
            sessionId,
            error: "Target peer ID required",
          }),
        );
        return;
      }

      const targetPeer = session.peers.get(targetPeerId);
      if (!targetPeer) {
        ws.send(
          JSON.stringify({
            type: "error",
            sessionId,
            error: "Target peer not found",
          }),
        );
        return;
      }

      // Find sender peer ID
      let senderPeerId: string | undefined;
      session.peers.forEach((peer) => {
        if (peer.ws === ws) {
          senderPeerId = peer.peerId;
        }
      });

      console.log(
        `Forwarding answer from ${senderPeerId} to peer ${targetPeerId} in session ${sessionId}`,
      );
      targetPeer.ws.send(
        JSON.stringify({
          type: "answer",
          sessionId,
          peerId: senderPeerId, // Include sender ID so client knows who sent the answer
          data,
        }),
      );
      break;
    }

    case "ice-candidate": {
      // P2P: Forward ICE candidate to the other peer(s)
      if (!sessionId) {
        console.error("Session ID missing in ice-candidate");
        ws.send(
          JSON.stringify({
            type: "error",
            sessionId: "",
            error: "Session ID required",
          }),
        );
        return;
      }

      const session = sessions.get(sessionId);
      if (!session || !session.peers) {
        ws.send(
          JSON.stringify({
            type: "error",
            sessionId,
            error: "Session not found",
          }),
        );
        return;
      }

      // ICE candidate should go to the target peer ID specified in the message
      const targetPeerId = message.peerId;
      if (!targetPeerId) {
        console.error("Target peer ID missing in ice-candidate");
        return;
      }

      const targetPeer = session.peers.get(targetPeerId);
      if (!targetPeer || targetPeer.ws.readyState !== WebSocket.OPEN) {
        console.error(`Target peer ${targetPeerId} not found or not connected`);
        return;
      }

      // Find sender peer ID
      let senderPeerId: string | undefined;
      session.peers.forEach((peer) => {
        if (peer.ws === ws) {
          senderPeerId = peer.peerId;
        }
      });

      console.log(
        `Forwarding ICE candidate from ${senderPeerId} to peer ${targetPeerId} in session ${sessionId}`,
      );

      targetPeer.ws.send(
        JSON.stringify({
          type: "ice-candidate",
          sessionId,
          peerId: senderPeerId, // Include sender ID so client knows who sent the candidate
          data,
        }),
      );

      let forwardedCount = 1;

      console.log(
        `Forwarded ICE candidate to ${forwardedCount} peer(s) in session ${sessionId}`,
      );
      break;
    }

    case "session-leave": {
      // Handle explicit peer leave
      if (!sessionId) {
        console.error("Session ID missing in session-leave");
        break;
      }
      const session = sessions.get(sessionId);
      if (!session || !session.peers) {
        console.log(`Session ${sessionId} not found for leave request`);
        break;
      }

      const peerId = message.peerId;
      if (!peerId) {
        console.error("Peer ID missing in session-leave");
        break;
      }

      // Remove peer from session
      const removedPeer = session.peers.get(peerId);
      if (removedPeer && removedPeer.ws === ws) {
        session.peers.delete(peerId);
        console.log(
          `Peer ${removedPeer.peerName} (${peerId}) explicitly left session ${sessionId}`,
        );

        // Broadcast updated peer list to remaining peers
        if (session.peers.size > 0) {
          broadcastPeerList(sessionId);
        } else {
          // No peers left, clean up session
          sessions.delete(sessionId);
          console.log(`Session ${sessionId} deleted (last peer left)`);
        }
      }

      break;
    }

    default:
      ws.send(
        JSON.stringify({
          type: "error",
          sessionId: sessionId || "",
          error: `Unknown message type: ${type}`,
        }),
      );
  }
}

// Create HTTP server for health checks
const httpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
  // Health check endpoint
  if (req.url === "/" || req.url === "/health") {
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    });
    res.end(
      JSON.stringify({
        status: "healthy",
        service: "butterfly-drop-signaling",
        version: "1.0.0",
        uptime: process.uptime(),
        activeSessions: sessions.size,
        environment: NODE_ENV,
        timestamp: new Date().toISOString(),
      }),
    );
    return;
  }

  // 404 for other routes
  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not Found");
});

// Create WebSocket server with production-ready configuration
const wss = new WebSocketServer({
  server: httpServer,
  perMessageDeflate: false, // Disable for better performance
  clientTracking: true,
});

// Start HTTP server on all interfaces (0.0.0.0) for LAN access
httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Butterfly Drop Signaling Server started`);
  console.log(`📡 Environment: ${NODE_ENV}`);
  console.log(`🔌 Port: ${PORT}`);
  console.log(`📊 Active sessions: ${sessions.size}`);
  console.log(`🏥 Health check: http://localhost:${PORT}/health`);
  console.log(`📱 LAN access: http://192.168.0.136:${PORT}/health`);
  console.log(`✅ WebSocket server ready for connections`);
  console.log(`🌐 Listening on all network interfaces (0.0.0.0)`);
});

wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
  const clientIp = req.socket.remoteAddress;
  console.log(`New WebSocket connection from ${clientIp}`);

  ws.on("message", (data: Buffer) => {
    try {
      const message: SignalingMessage = JSON.parse(data.toString());
      handleMessage(ws, message);
    } catch (error: unknown) {
      console.error("Failed to parse message:", error);
      ws.send(
        JSON.stringify({
          type: "error",
          sessionId: "",
          error: "Invalid message format",
        }),
      );
    }
  });

  ws.on("close", () => {
    console.log(`WebSocket connection closed from ${clientIp}`);
    // Clean up sessions where this connection was a peer
    for (const [sessionId, session] of sessions.entries()) {
      if (!session.peers) continue;

      // Find and remove the peer with this WebSocket connection
      let removedPeerId: string | null = null;
      let removedPeerName: string | null = null;

      session.peers.forEach((peer, peerId) => {
        if (peer.ws === ws) {
          removedPeerId = peerId;
          removedPeerName = peer.peerName;
        }
      });

      if (removedPeerId) {
        session.peers.delete(removedPeerId);
        console.log(
          `Peer ${removedPeerName} (${removedPeerId}) left session ${sessionId}`,
        );
        console.log(`Session ${sessionId} now has ${session.peers.size} peers`);

        // Broadcast updated peer list to remaining peers
        if (session.peers.size > 0) {
          broadcastPeerList(sessionId);
        } else {
          // No peers left, clean up session
          sessions.delete(sessionId);
          console.log(`Session ${sessionId} deleted (no peers remaining)`);
        }
      }

      // Legacy cleanup for backward compatibility
      if (session.sender === ws) {
        session.sender = undefined;
      }
      if (session.receiver === ws) {
        session.receiver = undefined;
      }
    }
  });

  ws.on("error", (error: Error) => {
    console.error("WebSocket error:", error);
  });
});

// Graceful shutdown
const shutdown = () => {
  console.log("\n🛑 Shutting down signaling server...");
  console.log("📊 Closing active sessions...");

  // Close all active connections
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.close(1000, "Server shutting down");
    }
  });

  // Close WebSocket server
  wss.close(() => {
    console.log("✅ WebSocket server closed");
  });

  // Close HTTP server
  httpServer.close(() => {
    console.log("✅ HTTP server closed gracefully");
    process.exit(0);
  });

  // Force exit after 10 seconds
  setTimeout(() => {
    console.error("⚠️ Forced shutdown after timeout");
    process.exit(1);
  }, 10000);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// Handle uncaught errors
process.on("uncaughtException", (error: Error) => {
  console.error("❌ Uncaught Exception:", error);
  shutdown();
});

process.on("unhandledRejection", (reason: unknown, promise: Promise<unknown>) => {
  console.error("❌ Unhandled Rejection at:", promise, "reason:", reason);
});

console.log("✅ Signal handlers registered");
