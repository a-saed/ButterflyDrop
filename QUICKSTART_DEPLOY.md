# 🚀 Quick Start: Deploy Butterfly Drop

Get your Butterfly Drop app running on real devices in **under 10 minutes**!

## 📱 What You'll Achieve

- ✅ Signaling server deployed (free hosting)
- ✅ Frontend app deployed (free hosting)
- ✅ Test file sharing between real devices (phone, tablet, computer)
- ✅ Share files over the internet (not just local network)

---

## 🎯 Option A: Railway + Vercel (Recommended - Easiest)

**Time: ~5 minutes** | **Cost: FREE**

### Step 1: Deploy Server to Railway (2 min)

1. **Go to [railway.app](https://railway.app)** and sign up with GitHub
2. Click **"New Project"** → **"Deploy from GitHub repo"**
3. Select your `butterfly-drop` repository
4. Railway will auto-detect and deploy!

5. **Configure:**
   - Click on your project → **"Settings"** → **"Domains"**
   - Click **"Generate Domain"**
   - Copy your URL: `https://your-app.railway.app`
   - Note: Change `https://` to `wss://` for WebSocket URL

6. **Set Environment Variables:**
   - Go to **"Variables"** tab
   - Add: `NODE_ENV` = `production`
   - Add: `PORT` = `8080`

✅ **Your signaling server is live!** URL: `wss://your-app.railway.app`

### Step 2: Deploy Frontend to Vercel (3 min)

1. **Go to [vercel.com](https://vercel.com)** and sign up with GitHub
2. Click **"New Project"** → Import your `butterfly-drop` repo
3. **Configure Build Settings:**
   - **Framework Preset:** Vite
   - **Root Directory:** `./` (or leave default)
   - **Build Command:** `pnpm build`
   - **Output Directory:** `dist`

4. **Add Environment Variable:**
   - Click **"Environment Variables"**
   - Name: `VITE_SIGNALING_URL`
   - Value: `wss://your-app.railway.app` (from Step 1)
   - Click **"Add"**

5. Click **"Deploy"** and wait ~2 minutes

✅ **Your app is live!** URL: `https://your-app.vercel.app`

### Step 3: Update Server CORS (1 min)

Go back to Railway:
1. Click your project → **"Variables"** tab
2. Add: `ALLOWED_ORIGINS` = `https://your-app.vercel.app`
3. Railway will auto-redeploy

✅ **Done! Test it now!**

---

## 🎯 Option B: Render (100% Free Forever)

**Time: ~7 minutes** | **Cost: FREE**

### Step 1: Deploy Server to Render (4 min)

1. **Go to [render.com](https://render.com)** and sign up with GitHub
2. Click **"New"** → **"Web Service"**
3. Connect your `butterfly-drop` repository
4. **Configure:**
   - **Name:** `butterfly-drop-signaling`
   - **Region:** Choose closest to you
   - **Branch:** `main` (or your default branch)
   - **Root Directory:** `server`
   - **Runtime:** Node
   - **Build Command:** `pnpm install && pnpm build`
   - **Start Command:** `pnpm start`
   - **Plan:** **Free**

5. **Environment Variables:**
   - Add: `NODE_ENV` = `production`
   - Add: `PORT` = `8080`

6. Click **"Create Web Service"**
7. Wait ~3 minutes for deployment
8. Copy your URL: `https://butterfly-drop-signaling.onrender.com`

✅ **Server deployed!** WebSocket URL: `wss://butterfly-drop-signaling.onrender.com`

### Step 2: Deploy Frontend to Vercel (3 min)

Same as Option A, Step 2 above, but use your Render URL:
- `VITE_SIGNALING_URL` = `wss://butterfly-drop-signaling.onrender.com`

### Step 3: Update Server CORS

Go back to Render:
1. Click your service → **"Environment"** tab
2. Add: `ALLOWED_ORIGINS` = `https://your-app.vercel.app`
3. Click **"Save Changes"** (will redeploy)

✅ **Done! Test it now!**

**Note:** Render free tier may sleep after 15 min of inactivity (takes ~30 seconds to wake up).

---

## 🧪 Test Your Deployment

### Test 1: Check Server Status

Open browser console on `https://your-app.vercel.app`:

```javascript
// Should log: "✅ Connected to signaling server"
```

### Test 2: Multi-Device Test

1. **Computer:** Open `https://your-app.vercel.app`
   - Should see "Scanning for peers..."
   - Copy the session URL (with `#session=...`)

2. **Phone:** Open the session URL or scan QR code
   - Both devices should see each other! 🎉

3. **Select files** → Click peer → Send!

### Test 3: Real File Transfer

1. Select a few images/files
2. Click on peer name
3. Click **"Send to [Peer]"**
4. Watch the butterfly animation! 🦋
5. Files should transfer instantly!

---

## 🐛 Troubleshooting

### Issue: "Can't connect to server"

**Check:**
```javascript
// In browser console
console.log(import.meta.env.VITE_SIGNALING_URL)
```

**Fix:**
- Make sure URL starts with `wss://` (not `ws://`)
- Verify environment variable in Vercel
- Rebuild and redeploy

### Issue: "Peers not discovering each other"

**Check Server Logs:**
- **Railway:** Dashboard → Deployments → View Logs
- **Render:** Dashboard → Logs tab

**Fix:**
- Check `ALLOWED_ORIGINS` includes your frontend URL
- Make sure both devices use the same session URL
- Try on different network (WiFi vs mobile data)

### Issue: "WebSocket connection error"

**Fix:**
1. Verify server is running (visit server URL in browser)
2. Check browser console for errors
3. Try clearing browser cache
4. Test on different browser

### Issue: "CORS errors in console"

**Fix:**
- Add your Vercel URL to `ALLOWED_ORIGINS` on server
- Format: `https://your-app.vercel.app` (no trailing slash)
- Redeploy server after updating

---

## 📊 Monitoring

### Check Server Health

**Railway:**
```
Dashboard → Metrics → View usage
Dashboard → Deployments → Logs
```

**Render:**
```
Dashboard → Metrics
Dashboard → Logs (real-time)
```

### Check Active Sessions

Server logs will show:
```
📊 Active sessions: X
Peer [Name] joined session [ID]
```

---

## 💡 Pro Tips

### Tip 1: Custom Domain (Optional)

**Vercel:**
- Settings → Domains → Add your domain
- Update `ALLOWED_ORIGINS` on server

### Tip 2: Better Performance

Add TURN server for better NAT traversal:
```env
VITE_STUN_SERVER=stun:stun.l.google.com:19302
```

### Tip 3: Monitor Usage

**Railway:**
- Free: $5 credit/month (~500 hours)
- Check usage: Dashboard → Usage

**Render:**
- Free: 750 hours/month
- Check: Dashboard → Billing

### Tip 4: Keep Render Awake

If using Render free tier, consider:
- Use [UptimeRobot](https://uptimerobot.com) to ping every 10 min
- Or upgrade to paid plan for always-on

### Tip 5: Multiple Environments

Create separate deployments:
- `butterfly-drop-staging` → Test new features
- `butterfly-drop-production` → Stable release

---

## 🎨 Frontend Deployment Alternatives

### Option 1: Vercel (Recommended)
✅ Unlimited bandwidth
✅ Global CDN
✅ Auto HTTPS
✅ Perfect for Vite/React

### Option 2: Netlify
✅ 100GB bandwidth/month
✅ Easy drag-and-drop
✅ Form handling

### Option 3: Cloudflare Pages
✅ Unlimited bandwidth
✅ Fast global CDN
✅ Built-in analytics

---

## 🔒 Security Notes

### Production Checklist:

- [ ] Use `wss://` (secure WebSocket)
- [ ] Set `ALLOWED_ORIGINS` correctly
- [ ] Use HTTPS for frontend
- [ ] Don't commit `.env` files
- [ ] Use environment variables for secrets
- [ ] Enable CORS properly
- [ ] Monitor server logs
- [ ] Set up error tracking (optional: Sentry)

---

## 📈 Scaling (Future)

When you outgrow free tier:

**Server:**
- Railway: $0.000463/GB-hour (~$20/month)
- Render: $7/month for always-on
- Fly.io: Pay as you go

**Frontend:**
- Vercel: $20/month Pro plan
- Netlify: $19/month Pro plan
- Cloudflare: Free forever (amazing!)

---

## 🎉 Success!

You now have a **production-ready P2P file sharing app** deployed on the internet!

### What's Working:

✅ Multi-device peer discovery
✅ Real-time file transfer
✅ QR code sharing
✅ Beautiful UI with animations
✅ PWA (installable on mobile)
✅ Dark/light theme
✅ No file size limits (browser only)
✅ End-to-end encrypted (WebRTC default)

### Share Your App!

Send the URL to friends:
```
🦋 Butterfly Drop
https://your-app.vercel.app

Share files instantly with P2P!
```

---

## 🆘 Need Help?

1. **Check logs** (most issues show up here)
2. **Test locally first** (`pnpm dev`)
3. **Verify environment variables**
4. **Check server status** (visit URL in browser)
5. **Try different network** (WiFi vs mobile data)

---

## 📝 Quick Reference

### Server URLs:
```bash
# Railway
wss://your-app.railway.app

# Render
wss://butterfly-drop-signaling.onrender.com

# Fly.io
wss://butterfly-drop-signaling.fly.dev
```

### Environment Variables:
```bash
# Server
NODE_ENV=production
PORT=8080
ALLOWED_ORIGINS=https://your-app.vercel.app

# Client
VITE_SIGNALING_URL=wss://your-server.com
```

### Useful Commands:
```bash
# Local development
pnpm dev                    # Start frontend
cd server && pnpm dev       # Start server

# Build for production
pnpm build                  # Build frontend
cd server && pnpm build     # Build server

# Deploy (from dashboard)
git push                    # Auto-deploys on Vercel/Render/Railway
```

---

## 🚀 Next Steps

1. ✅ Test on multiple devices
2. ✅ Share with friends
3. ✅ Monitor usage and logs
4. ✅ Customize UI/theme
5. ✅ Add more features!

---

## 🌟 You Did It!

Your Butterfly Drop app is now live and ready to share files across the internet! 🦋

**Let your files fly!** ✨