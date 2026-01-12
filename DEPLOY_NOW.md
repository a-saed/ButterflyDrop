# 🚀 Deploy Butterfly Drop - Complete Guide

## 🎯 What You're Deploying

A modern P2P file sharing app with:
- ✅ WebSocket signaling server (for peer discovery)
- ✅ React/Vite frontend (the actual app)
- ✅ Real-time peer-to-peer file transfers
- ✅ Works across different devices and networks

---

## 📦 Quick Deploy (10 Minutes Total)

### Step 1: Deploy Server (5 min) - Choose ONE option:

#### Option A: Railway.app (Easiest, $5 free credit)

1. Go to **[railway.app](https://railway.app)** → Sign up with GitHub
2. **New Project** → **Deploy from GitHub repo**
3. Select `butterfly-drop` repository
4. Railway auto-detects and deploys
5. **Settings** → **Generate Domain** → Copy URL
6. **Variables** tab → Add:
   ```
   NODE_ENV=production
   PORT=8080
   ```
7. ✅ Your server: `wss://your-app.railway.app`

#### Option B: Render.com (Best free tier, 100% free)

1. Go to **[render.com](https://render.com)** → Sign up with GitHub
2. **New** → **Web Service** → Connect repository
3. Configure:
   - **Root Directory:** `server`
   - **Build:** `pnpm install && pnpm build`
   - **Start:** `pnpm start`
   - **Plan:** Free
4. **Environment** → Add:
   ```
   NODE_ENV=production
   PORT=8080
   ```
5. ✅ Your server: `wss://butterfly-drop-signaling.onrender.com`

---

### Step 2: Deploy Frontend (5 min)

#### Vercel (Recommended)

1. Go to **[vercel.com](https://vercel.com)** → Sign up with GitHub
2. **New Project** → Import `butterfly-drop` repository
3. **Root Directory:** `./` (default)
4. **Build Command:** `pnpm build`
5. **Output Directory:** `dist`
6. **Environment Variables** → Add:
   ```
   VITE_SIGNALING_URL=wss://your-server-url-from-step-1
   ```
   Replace with your Railway or Render URL
7. Click **Deploy**
8. ✅ Your app: `https://your-app.vercel.app`

---

### Step 3: Connect Server to Frontend (2 min)

Go back to your server (Railway or Render):

1. Add environment variable:
   ```
   ALLOWED_ORIGINS=https://your-app.vercel.app
   ```
2. Server will auto-redeploy

✅ **DONE! Test it now!**

---

## 🧪 Test Your Deployment

### Test 1: Open on Computer
1. Visit: `https://your-app.vercel.app`
2. Should see "Butterfly Drop" with "Scanning for peers..."
3. Copy the session URL (has `#session=...`)

### Test 2: Open on Phone
1. Scan QR code OR paste the session URL
2. Both devices should see each other! 🎉

### Test 3: Send Files
1. Select files on one device
2. Click the peer name
3. Click "Send to [Peer]"
4. Files transfer instantly! 🦋

---

## 🐛 Troubleshooting

### Problem: "Can't connect to server"

**Check browser console:**
```javascript
console.log(import.meta.env.VITE_SIGNALING_URL)
// Should show: wss://your-server.com
```

**Fix:**
- Make sure URL starts with `wss://` (secure WebSocket)
- Rebuild and redeploy frontend
- Clear browser cache

### Problem: "Peers not discovering"

**Fix:**
1. Check server logs (Railway/Render dashboard)
2. Verify `ALLOWED_ORIGINS` includes your frontend URL
3. Try on different network (WiFi vs mobile data)
4. Make sure both devices use the SAME session URL

### Problem: "CORS errors"

**Fix:**
- Add frontend URL to `ALLOWED_ORIGINS` on server
- Format: `https://your-app.vercel.app` (no trailing slash)
- Redeploy server

### Problem: "Server sleeping" (Render only)

**Note:** Render free tier sleeps after 15 min inactivity
- Takes ~30 seconds to wake up on first connection
- Use Railway for always-on, or upgrade Render

---

## 📊 Check Server Health

Visit in browser:
```
https://your-server.railway.app/health
or
https://butterfly-drop-signaling.onrender.com/health
```

Should return:
```json
{
  "status": "healthy",
  "service": "butterfly-drop-signaling",
  "activeSessions": 0,
  "uptime": 123.45
}
```

---

## 💰 Costs & Limits

| Platform | Free Tier | Best For |
|----------|-----------|----------|
| **Railway** | $5 credit/month (~500 hrs) | Always-on server |
| **Render** | 750 hrs/month | Most generous free tier |
| **Vercel** | Unlimited | Frontend (perfect!) |

**Recommendation:** Use Render (free) + Vercel (free) = $0/month! 🎉

---

## 🔒 Security Checklist

- [x] Use `wss://` (secure WebSocket)
- [x] Use `https://` for frontend
- [x] Set `ALLOWED_ORIGINS` correctly
- [x] Don't commit `.env` files
- [x] Use environment variables for all config

---

## 🎨 Alternative Hosting Options

### Frontend Alternatives:
- **Netlify** - 100GB/month free, drag-and-drop deploy
- **Cloudflare Pages** - Unlimited bandwidth, super fast
- **GitHub Pages** - Free, direct from repo

### Server Alternatives:
- **Fly.io** - Free tier, global edge network
- **Heroku** - $5/month (not free anymore)
- **DigitalOcean** - $4/month (cheapest VPS)

---

## 📝 Environment Variables Reference

### Server (.env)
```bash
NODE_ENV=production
PORT=8080
ALLOWED_ORIGINS=https://your-frontend.vercel.app
SESSION_TIMEOUT=1800000  # 30 minutes
```

### Frontend (.env)
```bash
VITE_SIGNALING_URL=wss://your-server.railway.app
```

---

## 🔄 Update & Redeploy

### Update Server:
```bash
git add server/
git commit -m "Update server"
git push
# Auto-deploys on Railway/Render
```

### Update Frontend:
```bash
git add .
git commit -m "Update frontend"
git push
# Auto-deploys on Vercel
```

---

## 📱 Share Your App

Once deployed, share with anyone:

```
🦋 Butterfly Drop
Share files instantly with P2P!

https://your-app.vercel.app

✨ Features:
• No registration required
• End-to-end encrypted
• Works on any device
• Free forever
```

---

## 🆘 Still Having Issues?

1. **Check server logs:**
   - Railway: Dashboard → Deployments → Logs
   - Render: Dashboard → Logs tab

2. **Test WebSocket manually:**
   ```javascript
   // In browser console
   const ws = new WebSocket('wss://your-server.com');
   ws.onopen = () => console.log('✅ Connected!');
   ws.onerror = (e) => console.error('❌ Error:', e);
   ```

3. **Verify environment variables:**
   - Check all variables are set correctly
   - No typos in URLs
   - Redeploy after changes

4. **Test locally first:**
   ```bash
   cd server && pnpm dev     # Terminal 1
   pnpm dev                   # Terminal 2
   # Open http://localhost:5173
   ```

---

## 🎉 Success Checklist

- [ ] Server deployed and healthy
- [ ] Frontend deployed and accessible
- [ ] Environment variables configured
- [ ] Tested on 2+ devices
- [ ] Peers discover each other
- [ ] File transfer works
- [ ] QR code scanning works
- [ ] Shared with friends! 🦋

---

## 🚀 Next Steps

1. ✅ Test on multiple devices
2. ✅ Test on different networks
3. ✅ Share with friends
4. ✅ Monitor server logs
5. ✅ Customize theme/branding
6. ✅ Add more features!

---

## 📚 Full Documentation

- **Deployment Details:** See `server/DEPLOYMENT.md`
- **Architecture:** See `ARCHITECTURE.md`
- **Development:** See `README.md`

---

## 🌟 You Did It!

Your Butterfly Drop app is now live and accessible from anywhere in the world!

**Let your files fly!** 🦋✨

---

**Need help?** Check server logs, verify URLs, test locally first.

**It works?** Share your app URL with the world! 🌍