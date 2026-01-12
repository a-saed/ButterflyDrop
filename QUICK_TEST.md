# Quick Testing Guide

## 🚀 How to Test Butterfly Drop Connections

### Prerequisites
- ✅ Server running on port 8080
- ✅ Frontend running on port 5173
- ✅ Two browser tabs or devices on same network

---

## Step-by-Step Testing

### 1️⃣ Open First Tab (Sender)

```
http://localhost:5173/
```

**What should happen:**
- ✅ URL changes to `http://localhost:5173/#session=abc123xyz`
- ✅ Console shows:
  ```
  🆕 [useSession] No session in URL, creating new session
  [SessionContext] Creating new P2P session: abc123xyz
  🦋 Initializing session abc123xyz...
  ✅ Joined session, received peer list
  💡 No other peers yet! Share the session URL to invite others.
  ```
- ✅ UI shows "Scanning for devices..." or invite section

### 2️⃣ Copy the Shareable URL

Look at the top of the page for the ShareLink component. The URL should look like:
```
http://192.168.0.136:5173/#session=abc123xyz
```

**Options:**
- Click the Copy button (📋)
- Click QR Code button to get QR code
- Manually copy from browser's address bar

### 3️⃣ Open Second Tab (Receiver)

**Paste the FULL shareable URL** (with 192.168.0.136, not localhost):
```
http://192.168.0.136:5173/#session=abc123xyz
```

**What should happen:**
- ✅ Console shows:
  ```
  🔗 [useSession] Extracted session ID: abc123xyz
  👋 [useSession] Joining existing session: abc123xyz
  🦋 Initializing session abc123xyz...
  ✅ Joined session, received peer list
  👥 Peer list updated, processing 2 total peers
  🔍 Found 1 other peers after filtering self
  🤝 Processing peer: [Device Name]
     Already connected: false
     🎭 I am impolite (lower ID)
     ✅ I will initiate connection to [Device Name]
  ```

### 4️⃣ Watch Connection Establishment

**In BOTH tabs, you should see:**

```
🚀 Initiating connection to peer def456...
   📊 Peer connection state created for def456 (offerer)
   📝 Created offer for def456
   ✅ Local description set (offer)
📤 Sending offer to peer def456
   ✅ Offer sent successfully
🧊 Sending ICE candidate to peer def456 (host)
🧊 Sending ICE candidate to peer def456 (srflx)
```

**Then the other tab receives:**

```
📨 Received signaling message: offer from abc123...
   Processing offer from abc123...
📥 Received offer from peer abc123
   📊 Peer connection state created for abc123 (answerer)
✅ Remote description set for abc123
📤 Sending answer to peer abc123
🧊 Received ICE candidate from peer abc123
✅ Added ICE candidate for abc123
```

**Finally, CONNECTION ESTABLISHED:**

```
🔗 Connection state with def456: connected
🧊 ICE connection state with def456: connected
✅ Data channel opened with def456 (offerer)
✅ WebRTC connection ready with def456
```

### 5️⃣ Visual Indicators

**In the UI, peer avatars should show:**

- 🟡 Yellow spinner → Connecting (first 2-5 seconds)
- 🟢 Green checkmark → Ready to transfer!

**Hover over peer avatar to see:**
- "Connecting..." → Yellow spinner
- "Ready" → Green checkmark

### 6️⃣ Send a File

1. Select a file (drag & drop or click)
2. Click on the peer avatar (should have green checkmark)
3. Click "Send" button
4. File should transfer instantly!

---

## ❌ Troubleshooting

### No Connection Logs?

**Check:**
```
👥 Peer list updated, processing X total peers
```

If you see `processing 1 total peers` (only yourself), the second tab didn't join properly.

**Solution:** Make sure you used the FULL shareable URL with the LAN IP, not localhost.

---

### Yellow Spinner Forever?

**Check console for:**
```
🚀 Initiating connection to peer...
📤 Sending offer to peer...
```

If you DON'T see these logs, the connection initiation is not triggering.

**Check if you see:**
```
✅ I will initiate connection
```
or
```
⏳ I will wait for [peer] to initiate
```

One peer should initiate (impolite/lower ID), the other should wait (polite/higher ID).

---

### "Target peer not found" Error?

This means the signaling server can't find the target peer.

**Check:**
- Both tabs are connected to the signaling server
- Session IDs match in both tabs
- Server logs show both peers joined

---

### ICE Connection Failed?

**Console shows:**
```
❌ ICE connection failed with xyz
```

**Possible causes:**
- Firewall blocking WebRTC
- Need TURN server for NAT traversal
- Network doesn't allow P2P connections

**Quick test:** Try on same machine with two tabs first.

---

## 🎯 Expected Timeline

| Time | What Should Happen |
|------|-------------------|
| 0s | First tab opens, creates session |
| 2s | Second tab joins session |
| 3s | Peer discovery complete, yellow spinners show |
| 4s | Offers sent, answers received |
| 5s | ICE negotiation complete |
| 6s | 🟢 Green checkmarks appear - READY! |

**Total time: ~5-6 seconds maximum**

If it takes longer than 10 seconds, something is wrong.

---

## 📊 Full Console Output Example

### Tab 1 (Sender):
```
🆕 [useSession] No session in URL, creating new session
[SessionContext] Creating new P2P session: abc123xyz
🦋 Initializing session abc123xyz...
✅ Connected to signaling server
✅ Joined session, received peer list
💡 No other peers yet!

[After Tab 2 joins...]

🔄 Peer list updated
👥 Peer list updated, processing 2 total peers
🔍 Found 1 other peers after filtering self
🤝 Processing peer: iPhone (def456...)
   Already connected: false
   🎭 I am impolite (lower ID)
   ✅ I will initiate connection to iPhone
🚀 Initiating connection to peer def456
📤 Sending offer to peer def456
🧊 Sending ICE candidate to peer def456 (host)
📥 Received answer from peer def456
✅ Remote description set for def456
🧊 Added ICE candidate for def456
✅ Data channel opened with def456
✅ WebRTC connection ready with def456
```

### Tab 2 (Receiver):
```
🔗 [useSession] Extracted session ID: abc123xyz
👋 [useSession] Joining existing session
🦋 Initializing session abc123xyz...
✅ Connected to signaling server
✅ Joined session, received peer list
🎉 Found 1 other peer(s)!
👥 Peer list updated, processing 2 total peers
🔍 Found 1 other peers after filtering self
🤝 Processing peer: MacBook (abc123...)
   Already connected: false
   🎭 I am polite (higher ID)
   ⏳ I will wait for MacBook to initiate
📥 Received offer from peer abc123
✅ Remote description set for abc123
📤 Sending answer to peer abc123
🧊 Received ICE candidate from peer abc123
✅ Added ICE candidate for abc123
✅ Data channel opened with abc123
✅ WebRTC connection ready with abc123
```

---

## 🐛 Debug Checklist

- [ ] Server is running on port 8080
- [ ] Frontend is running on port 5173
- [ ] Both tabs show "Connected to signaling server"
- [ ] Both tabs joined the SAME session ID
- [ ] Peer list shows other peers (not just self)
- [ ] One peer is "impolite" (initiates), other is "polite" (waits)
- [ ] Offers and answers are being sent/received
- [ ] ICE candidates are being exchanged
- [ ] Data channel opens successfully
- [ ] Green checkmarks appear on peer avatars

---

## 💡 Pro Tips

1. **Use Chrome DevTools** - Network tab → WS filter → See WebSocket messages
2. **Check Server Logs** - `tail -f server.log` to see signaling messages
3. **Test Locally First** - Two tabs on same machine before testing across devices
4. **Clear State** - Refresh both tabs to start fresh if things get stuck
5. **Use Incognito** - Avoid cache/localStorage issues

---

## ✅ Success Criteria

You've successfully tested when:
- ✅ Peer avatars show green checkmarks
- ✅ Console shows "WebRTC connection ready"
- ✅ Can send files instantly (no waiting)
- ✅ Transfer shows progress and completes
- ✅ Both sides can send to each other

**If all these work: 🎉 Congratulations! WebRTC is working perfectly!**

---

**Last Updated:** 2024
**Status:** ✅ Complete