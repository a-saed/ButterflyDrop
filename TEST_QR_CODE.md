# 📱 QR Code Testing Guide

Test the QR code functionality to ensure devices can join the same session.

## 🎯 What We're Testing

When you scan a QR code with your mobile device:
1. ✅ Mobile extracts session ID from URL
2. ✅ Mobile joins the SAME session as laptop
3. ✅ Both devices see each other in peer list
4. ✅ Can transfer files between devices

---

## 🚀 Step-by-Step Test

### Step 1: Start Servers

```bash
# Terminal 1 - Server
cd butterfly-drop/server
node dist/index.js

# Terminal 2 - Frontend
cd butterfly-drop
pnpm dev --host
```

**Expected Output:**
```
🚀 Butterfly Drop Signaling Server started
📱 LAN access: http://192.168.0.136:8080/health
🌐 Listening on all network interfaces (0.0.0.0)
```

```
➜  Local:   http://localhost:5173/
➜  Network: http://192.168.0.136:5173/
```

---

### Step 2: Open on Laptop

1. Open: `http://localhost:5173`
2. **Check browser console for:**
   ```
   🔄 [useSession] Hook initialized
   🆕 [useSession] No session in URL, creating new session
   [SessionContext] Creating new P2P session: ABC123XYZ
   🔗 [sessionUtils] Creating shareable URL
     - Session ID: ABC123XYZ
     - Shareable URL: http://localhost:5173#session=ABC123XYZ
   ✅ [useSession] URL updated with session ID: ABC123XYZ
   ```

3. **Check the address bar:**
   - Should show: `http://localhost:5173#session=ABC123XYZ`
   - The `#session=ABC123XYZ` part is critical!

4. **Click the QR code icon** (top-right, near theme toggle)

5. **Check console for QR code generation:**
   ```
   🔗 [ShareLink] QR Code URL generated:
     - Full URL: http://localhost:5173#session=ABC123XYZ
     - Session ID: ABC123XYZ
     ✅ Scan this QR code to join session
   ```

6. **Verify QR code dialog shows:**
   - Large QR code image
   - Full URL displayed below
   - Green checkmark: "✅ QR code contains this URL"

---

### Step 3: Scan QR Code on Mobile

#### Option A: Camera App (Recommended)
1. Open native camera app on iPhone/Android
2. Point at QR code on laptop screen
3. Tap notification/link that appears
4. Should open browser with URL: `http://192.168.0.136:5173#session=ABC123XYZ`

#### Option B: QR Scanner App
1. Open any QR scanner app
2. Scan the code
3. Open the URL it shows

#### Option C: Manual URL (Backup)
1. Copy URL from laptop: `http://192.168.0.136:5173#session=ABC123XYZ`
2. Type into mobile browser
3. **IMPORTANT:** Make sure to include the `#session=ABC123XYZ` part!

---

### Step 4: Check Mobile Joining Session

**On mobile browser console** (if you can access it):
```
🔄 [useSession] Effect triggered - checking URL for session
  - Current URL: http://192.168.0.136:5173#session=ABC123XYZ
  - Extracted session ID: ABC123XYZ
✅ [useSession] Joining existing session from URL: ABC123XYZ
[SessionContext] Joining P2P session: ABC123XYZ
🔌 Connecting to signaling server: ws://192.168.0.136:8080
✅ Connected to signaling server successfully!
🆔 Setting my peer ID: mkb2xyz-abc123
Joining P2P network ABC123XYZ as iPhone (mkb2xyz-abc123)
```

**Key indicators mobile joined correctly:**
- ✅ "Joining existing session from URL"
- ✅ Session ID matches laptop's session ID
- ✅ Connected to signaling server

---

### Step 5: Verify Both Devices See Each Other

**On Laptop - Check Debug Panel (bottom-right):**
```
🔍 Connection Status
Session: ABC123XY
State: connected
My ID: mkb2abc1

Session Peers: 2
  • Linux PC (mkb2abc1)
  • iPhone (mkb2xyz1)

Discovered: 1
  • iPhone (mkb2xyz1) ✅
```

**On Mobile - Check Debug Panel:**
```
🔍 Connection Status
Session: ABC123XY
State: connected
My ID: mkb2xyz1

Session Peers: 2
  • Linux PC (mkb2abc1)
  • iPhone (mkb2xyz1)

Discovered: 1
  • Linux PC (mkb2abc1) ✅
```

**Success Criteria:**
- ✅ Same session ID on both devices
- ✅ State: "connected" on both
- ✅ Session Peers: 2 (both devices)
- ✅ Discovered: 1 (the OTHER device)
- ✅ Each sees the other's name correctly

---

### Step 6: Test File Transfer

1. **On laptop:** Select a test file (image, PDF, etc.)
2. **Click on mobile peer name** in the UI
3. **Click "Send to iPhone"** button
4. **Watch for transfer progress** (butterfly animation)
5. **Mobile should receive** the file automatically

---

## 🐛 Troubleshooting

### Issue: Mobile opens URL but no `#session=` in address bar

**Problem:** QR code might not include the session ID

**Check:**
1. Open QR code dialog on laptop
2. Look at URL shown below QR code
3. Should have: `http://192.168.0.136:5173#session=ABC123XYZ`
4. If missing `#session=`, there's a bug in URL generation

**Fix:**
- Check browser console for `createShareableUrl` logs
- Verify session ID is being generated

---

### Issue: Mobile shows different session ID than laptop

**Problem:** Mobile is creating NEW session instead of joining existing one

**Check mobile console for:**
```
❌ [useSession] No session ID in URL  (WRONG!)
vs
✅ [useSession] Joining existing session from URL: ABC123XYZ  (CORRECT!)
```

**Possible causes:**
1. URL doesn't include `#session=ABC123XYZ`
2. QR code was scanned from old/expired session
3. Hash fragment was stripped by browser/app

**Fix:**
- Ensure QR code URL includes the hash: `#session=ABC123XYZ`
- Try manually typing URL with hash fragment
- Use a different QR scanner app
- Copy/paste URL directly

---

### Issue: QR code scans but opens wrong URL

**Problem:** QR code might contain localhost instead of LAN IP

**Check QR code URL should be:**
✅ `http://192.168.0.136:5173#session=ABC123XYZ`  (LAN IP)
❌ `http://localhost:5173#session=ABC123XYZ`     (won't work from mobile)

**Fix:**
- The app should auto-detect and use LAN IP in QR code
- If not, manually update `.env.local`:
  ```env
  VITE_SIGNALING_URL=ws://192.168.0.136:8080
  ```
- Rebuild: `pnpm build`
- Restart frontend: `pnpm dev --host`

---

### Issue: Both devices in same session but don't see each other

**Check server logs:**
```bash
tail -f server.log
# or if running in terminal, look for:
Session ABC123XYZ now has 2 total peers
Peer names: iPhone, Linux PC
Broadcasting peer list: 2 peers to 2 connections
```

**If server shows 2 peers but clients don't see each other:**
- This is a peer filtering issue (should be fixed now)
- Check console for: "🚫 Filtering out SELF"
- Verify "Discovered: 1" shows OTHER device

**If server only shows 1 peer:**
- Mobile didn't connect to server
- Check mobile console for WebSocket connection errors
- Verify firewall allows port 8080
- Try `curl http://192.168.0.136:8080/health` from mobile

---

### Issue: Can't scan QR code (camera doesn't recognize it)

**Workarounds:**
1. **Copy URL manually**
   - Click "Copy URL" button
   - Send via messaging app (WhatsApp, iMessage)
   - Open on mobile

2. **Use alternative QR scanner**
   - Download dedicated QR scanner app
   - Some camera apps have issues with QR codes

3. **Manual URL entry**
   - Type URL on mobile: `http://192.168.0.136:5173#session=ABC123XYZ`
   - Must include the `#session=` part!

---

## ✅ Success Checklist

- [ ] Laptop creates session with unique ID
- [ ] QR code displays correctly with session URL
- [ ] QR code URL includes `#session=ABC123XYZ`
- [ ] Mobile scans QR code successfully
- [ ] Mobile opens URL with correct session ID
- [ ] Mobile joins SAME session as laptop
- [ ] Both devices show "connected" state
- [ ] Laptop sees "iPhone" in discovered peers
- [ ] Mobile sees "Linux PC" in discovered peers
- [ ] File transfer works between devices
- [ ] QR code can be rescanned by other devices

---

## 📊 Expected Console Logs Flow

### Laptop (Session Creator):
```
🆕 Creating new session: ABC123XYZ
🔗 Shareable URL: http://localhost:5173#session=ABC123XYZ
🔗 QR Code URL: http://localhost:5173#session=ABC123XYZ
✅ Connected to signaling server
Joining P2P network ABC123XYZ as Linux PC
✅ Joined P2P network, received peers: [Linux PC]
🚫 Filtering out SELF: Linux PC
📡 Setting 0 OTHER peers (waiting for others...)
```

### Mobile (Session Joiner):
```
🔄 Checking URL for session
  - Extracted session ID: ABC123XYZ
✅ Joining existing session from URL: ABC123XYZ
✅ Connected to signaling server
Joining P2P network ABC123XYZ as iPhone
✅ Joined P2P network, received peers: [Linux PC, iPhone]
🚫 Filtering out SELF: iPhone
📡 Setting 1 OTHER peers
📋 Other peer details: ["Linux PC (mkb2abc1...)"]
```

### Both Devices (After Both Join):
```
🔄 Peer list updated: [Linux PC, iPhone]
🚫 Filtering out SELF: [device name]
📡 Updating to 1 OTHER peers
```

---

## 🎉 Final Verification

When everything works correctly:

1. ✅ **Same session ID** on both devices
2. ✅ **"Connected" state** on both devices
3. ✅ **Each device discovers exactly 1 peer** (the other device)
4. ✅ **Correct device names** (iPhone, Linux PC, etc.)
5. ✅ **File transfer works** between devices
6. ✅ **Additional devices can scan same QR code** and join

---

## 💡 Pro Tips

### Tip 1: Keep QR Code Open
- QR code remains valid for entire session
- Multiple devices can scan the same code
- No need to regenerate for each device

### Tip 2: Use Chrome DevTools for Mobile
```bash
# Connect Android phone via USB
# Enable USB debugging
# Open chrome://inspect on laptop
# Select mobile device
# View mobile console logs!
```

### Tip 3: Test Session Persistence
- Refresh page on mobile
- Should rejoin same session automatically
- Session ID stays in URL

### Tip 4: Network Switch Test
- Switch mobile between WiFi and mobile data
- Both should work (uses WebSocket over internet)

---

## 🚀 Ready for Production?

If all tests pass:
- ✅ QR code functionality works
- ✅ Session joining works
- ✅ Peer discovery works
- ✅ File transfer works
- ✅ **Ready to deploy!**

See `DEPLOY_NOW.md` for deployment instructions.

---

**Last Updated:** January 2026  
**Status:** Ready for Testing