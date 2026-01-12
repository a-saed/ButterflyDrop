# 📱 Test Butterfly Drop on Your Mobile Device

Quick guide to test the app on your phone without deploying to a remote server.

## 🎯 Requirements

- ✅ Laptop and mobile on **same WiFi network**
- ✅ Your laptop's IP address: `192.168.0.136`
- ✅ Firewall allows ports 5173 (frontend) and 8080 (server)

---

## 🚀 Quick Start (Easiest Way)

### Option 1: Use the Helper Script

```bash
# Run this from the butterfly-drop directory
./test-mobile.sh
```

That's it! The script will:
- ✅ Detect your IP automatically
- ✅ Build and start the server
- ✅ Start the frontend with `--host`
- ✅ Show you the URLs to open

Then:
1. **On Mobile:** Open `http://192.168.0.136:5173`
2. **On Laptop:** Open `http://localhost:5173`
3. Both devices should see each other! 🎉

---

## 🔧 Option 2: Manual Setup (Step by Step)

### Step 1: Find Your Laptop's IP Address

```bash
# On Linux/Mac
hostname -I | awk '{print $1}'

# Or
ip addr show | grep "inet " | grep -v 127.0.0.1

# Result should be something like: 192.168.0.136
```

### Step 2: Create `.env.local` File

Create a file called `.env.local` in the `butterfly-drop/` directory:

```env
# Replace with YOUR laptop's IP
VITE_SIGNALING_URL=ws://192.168.0.136:8080
```

### Step 3: Build and Start Server

```bash
# Terminal 1 - Build server
cd butterfly-drop/server
pnpm build

# Start server (listens on all interfaces)
node dist/index.js
```

You should see:
```
🚀 Butterfly Drop Signaling Server started
📱 LAN access: http://192.168.0.136:8080/health
🌐 Listening on all network interfaces (0.0.0.0)
```

### Step 4: Start Frontend with Host Flag

```bash
# Terminal 2 - Start frontend
cd butterfly-drop
pnpm dev --host
```

You should see:
```
➜  Local:   http://localhost:5173/
➜  Network: http://192.168.0.136:5173/
```

### Step 5: Test on Devices

**On Laptop:**
- Open: `http://localhost:5173`

**On Mobile:**
- Open: `http://192.168.0.136:5173`
- Make sure you're on the **same WiFi network**

Both devices should discover each other and you can test file transfers! 🦋

---

## 🧪 Verify Everything Works

### Test 1: Check Server Health

On your laptop or mobile browser:
```
http://192.168.0.136:8080/health
```

Should return:
```json
{
  "status": "healthy",
  "service": "butterfly-drop-signaling",
  "activeSessions": 0
}
```

### Test 2: Check WebSocket Connection

Open browser console on mobile (use Chrome DevTools via USB debugging):
```javascript
const ws = new WebSocket('ws://192.168.0.136:8080');
ws.onopen = () => console.log('✅ Connected!');
ws.onerror = (e) => console.error('❌ Error:', e);
```

Should log: `✅ Connected!`

---

## 🐛 Troubleshooting

### Issue: "Can't access from mobile"

**Check 1: Same WiFi Network**
```bash
# On laptop, check your network
ip addr show

# On mobile, check WiFi settings
# Make sure both show same network name
```

**Check 2: Firewall**
```bash
# Allow ports 5173 and 8080
sudo ufw allow 5173
sudo ufw allow 8080

# Or temporarily disable firewall
sudo ufw disable
```

**Check 3: Test Port Accessibility**
```bash
# On laptop, test if port is open
curl http://localhost:8080/health

# On mobile, test from browser
http://192.168.0.136:8080/health
```

### Issue: "Server not responding"

**Fix:**
```bash
# Make sure server is listening on 0.0.0.0, not 127.0.0.1
# Check server logs for:
# "🌐 Listening on all network interfaces (0.0.0.0)"

# If not, rebuild server and restart
cd server
pnpm build
node dist/index.js
```

### Issue: "WebSocket connection failed"

**Check environment variable:**
```bash
# Should show your laptop's IP, not localhost
cat .env.local
# Should have: VITE_SIGNALING_URL=ws://192.168.0.136:8080
```

**Restart frontend after changing .env.local:**
```bash
# Kill frontend
pkill -f vite

# Restart
pnpm dev --host
```

### Issue: "Peers not discovering each other"

**Fix:**
1. Check both devices show "Connected" status
2. Open browser console on both devices
3. Look for: `✅ Connected to signaling server`
4. Check server logs: `New WebSocket connection from...`
5. Try creating new session (refresh browser)

---

## 🔍 Debug Mode

### View Server Logs
```bash
# If using helper script
tail -f server.log

# If running manually
# Server logs appear in Terminal 1
```

### View Frontend Logs
```bash
# If using helper script
tail -f frontend.log

# If running manually
# Frontend logs appear in Terminal 2
```

### Check Active Connections
```bash
# View server health
curl http://192.168.0.136:8080/health | jq

# Should show activeSessions count
```

---

## 🛑 Stop Testing

### If using helper script:
```bash
# Press Ctrl+C in the script terminal
# Or manually:
pkill -f 'node.*dist/index.js'
pkill -f vite
```

### If running manually:
```bash
# Press Ctrl+C in both terminals
```

---

## 📝 Quick Reference

| What | URL |
|------|-----|
| **Mobile Browser** | `http://192.168.0.136:5173` |
| **Laptop Browser** | `http://localhost:5173` |
| **Server Health** | `http://192.168.0.136:8080/health` |
| **WebSocket** | `ws://192.168.0.136:8080` |

---

## 💡 Pro Tips

### Tip 1: Use QR Code
1. Open app on laptop: `http://localhost:5173`
2. Session creates a QR code automatically
3. Scan with mobile phone camera
4. Opens app with correct session URL! 📱

### Tip 2: USB Debugging (Android)
```bash
# Connect phone via USB
# Enable USB debugging in Developer Options
# Open Chrome DevTools on laptop
chrome://inspect
# View mobile console for debugging
```

### Tip 3: Test on Multiple Devices
- Laptop: `http://localhost:5173`
- Phone: `http://192.168.0.136:5173`
- Tablet: `http://192.168.0.136:5173`

All should discover each other in the same session!

### Tip 4: Update IP if Changed
If your laptop's IP changes:
```bash
# Update .env.local with new IP
# Rebuild server
cd server && pnpm build
# Restart both servers
```

---

## 🎉 Success Checklist

- [ ] Server running and showing `🌐 Listening on all network interfaces`
- [ ] Frontend running with `--host` flag
- [ ] Mobile and laptop on same WiFi network
- [ ] Can access `http://192.168.0.136:5173` from mobile
- [ ] Health check returns `{"status":"healthy"}`
- [ ] Both devices see each other as peers
- [ ] Can select files and send between devices
- [ ] Files transfer successfully! 🦋

---

## 🚀 Ready to Deploy for Real?

Once local testing works, deploy for internet access:
1. See `DEPLOY_NOW.md` for deployment guide
2. Deploy server to Render/Railway
3. Deploy frontend to Vercel
4. Test from anywhere in the world! 🌍

---

**Need help?** Check server logs, verify IPs, ensure same WiFi network.

**It works?** Time to deploy for real! 🚀