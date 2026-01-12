# 🚀 Butterfly Drop Signaling Server - Deployment Guide

This guide will help you deploy the Butterfly Drop signaling server to a free hosting platform for real-world testing.

## 📋 Prerequisites

- GitHub account
- Git installed locally
- Node.js 18+ installed

## 🎯 Recommended Free Hosting Platforms

### Option 1: Railway.app ⭐ (Easiest)

**Pros:**
- $5 free credit/month (plenty for testing)
- Native WebSocket support
- Auto-deploy from GitHub
- Very simple setup

**Cons:**
- Free credit expires after trial period (but easy to upgrade)

### Option 2: Render.com ⭐ (Best Free Tier)

**Pros:**
- Completely free tier (no credit card required)
- 750 hours/month free
- Native WebSocket support
- Auto-deploy from GitHub

**Cons:**
- Free tier may spin down after inactivity (15 min to restart)

### Option 3: Fly.io

**Pros:**
- Free tier available
- Great for global edge deployment
- Low latency worldwide

**Cons:**
- More complex setup
- Requires CLI installation

---

## 🚂 Deploy to Railway.app (Recommended)

### Step 1: Prepare Your Code

1. Make sure your server code is committed to GitHub:
```bash
cd server
git add .
git commit -m "Prepare server for deployment"
git push
```

### Step 2: Deploy on Railway

1. Go to [railway.app](https://railway.app)
2. Sign up with GitHub
3. Click "New Project" → "Deploy from GitHub repo"
4. Select your `butterfly-drop` repository
5. Railway will auto-detect the Node.js app

### Step 3: Configure Environment Variables

In Railway dashboard:

1. Go to your project → "Variables" tab
2. Add these variables:
   ```
   NODE_ENV=production
   PORT=8080
   ALLOWED_ORIGINS=https://your-frontend-url.vercel.app
   ```

### Step 4: Get Your WebSocket URL

1. In Railway, go to "Settings" → "Domains"
2. Click "Generate Domain"
3. Your WebSocket URL will be: `wss://your-app.railway.app`
4. Copy this URL - you'll need it for the client!

### Step 5: Test Connection

Open browser console and test:
```javascript
const ws = new WebSocket('wss://your-app.railway.app');
ws.onopen = () => console.log('✅ Connected!');
ws.onerror = (err) => console.error('❌ Error:', err);
```

---

## 🎨 Deploy to Render.com (Best Free Option)

### Step 1: Prepare Your Code

Make sure you have these files in `server/`:
- ✅ `render.yaml` (already created)
- ✅ `package.json`
- ✅ `tsconfig.json`

### Step 2: Deploy on Render

1. Go to [render.com](https://render.com)
2. Sign up with GitHub
3. Click "New" → "Web Service"
4. Connect your GitHub repository
5. Configure:
   - **Name:** `butterfly-drop-signaling`
   - **Environment:** `Node`
   - **Build Command:** `pnpm install && pnpm build`
   - **Start Command:** `pnpm start`
   - **Plan:** Free

### Step 3: Configure Environment Variables

In Render dashboard:

1. Go to "Environment" tab
2. Add these variables:
   ```
   NODE_ENV=production
   PORT=8080
   ALLOWED_ORIGINS=https://your-frontend-url.vercel.app
   ```

### Step 4: Get Your WebSocket URL

1. After deployment, Render will give you a URL like: `https://butterfly-drop-signaling.onrender.com`
2. Your WebSocket URL: `wss://butterfly-drop-signaling.onrender.com`
3. Copy this URL!

### Step 5: Test Connection

```bash
curl -I https://butterfly-drop-signaling.onrender.com
```

---

## 🌐 Deploy to Fly.io

### Step 1: Install Fly CLI

```bash
# macOS/Linux
curl -L https://fly.io/install.sh | sh

# Windows (PowerShell)
iwr https://fly.io/install.ps1 -useb | iex
```

### Step 2: Login and Initialize

```bash
cd server
fly auth login
fly launch
```

Follow the prompts:
- App name: `butterfly-drop-signaling`
- Region: Choose closest to you
- PostgreSQL: No
- Redis: No

### Step 3: Configure and Deploy

```bash
# Set environment variables
fly secrets set NODE_ENV=production
fly secrets set ALLOWED_ORIGINS=https://your-frontend.vercel.app

# Deploy
fly deploy
```

### Step 4: Get Your URL

```bash
fly info
```

Your WebSocket URL: `wss://butterfly-drop-signaling.fly.dev`

---

## 🔧 Update Client Configuration

After deploying the server, update your client:

### 1. Create Environment File

Create `butterfly-drop/.env`:

```env
# Production signaling server
VITE_SIGNALING_URL=wss://your-app.railway.app

# Or for Render
# VITE_SIGNALING_URL=wss://butterfly-drop-signaling.onrender.com

# Or for Fly.io
# VITE_SIGNALING_URL=wss://butterfly-drop-signaling.fly.dev
```

### 2. Update for Local Development

Create `butterfly-drop/.env.local`:

```env
# Local development
VITE_SIGNALING_URL=ws://localhost:8080
```

### 3. Rebuild Client

```bash
cd butterfly-drop
pnpm build
```

---

## 📱 Deploy Frontend (Client)

### Deploy to Vercel (Recommended for Frontend)

1. Go to [vercel.com](https://vercel.com)
2. Sign up with GitHub
3. Click "New Project"
4. Import your `butterfly-drop` repository
5. Configure:
   - **Framework:** Vite
   - **Root Directory:** `butterfly-drop` (if monorepo)
   - **Build Command:** `pnpm build`
   - **Output Directory:** `dist`
   - **Environment Variables:** Add `VITE_SIGNALING_URL`

6. Click "Deploy"

Your app will be live at: `https://your-app.vercel.app`

### Alternative: Deploy to Netlify

1. Go to [netlify.com](https://netlify.com)
2. Drag & drop your `dist` folder, or
3. Connect GitHub and auto-deploy

---

## 🧪 Testing Real-World Scenario

### Test on Different Devices

1. **Device 1 (Computer):**
   - Open: `https://your-app.vercel.app`
   - Create session, get URL

2. **Device 2 (Phone):**
   - Open the session URL or scan QR code
   - Both devices should discover each other!

3. **Device 3 (Tablet):**
   - Join same session
   - All 3 devices should see each other

### Debugging Connection Issues

If peers don't connect:

1. **Check WebSocket Connection:**
   ```javascript
   // In browser console
   console.log('Signaling URL:', import.meta.env.VITE_SIGNALING_URL)
   ```

2. **Check Server Logs:**
   - Railway: View in dashboard
   - Render: Check logs tab
   - Fly.io: `fly logs`

3. **Check CORS:**
   - Make sure `ALLOWED_ORIGINS` includes your frontend URL

4. **Check Network:**
   - Some corporate networks block WebSockets
   - Try mobile data or different network

---

## 🔍 Monitoring & Logs

### Railway
```
Dashboard → Deployments → View Logs
```

### Render
```
Dashboard → Logs tab (real-time)
```

### Fly.io
```bash
fly logs
fly status
```

---

## 💰 Free Tier Limits

| Platform | Free Tier | Notes |
|----------|-----------|-------|
| Railway | $5 credit/month | ~500 hours |
| Render | 750 hours/month | May sleep after 15min inactive |
| Fly.io | 3 shared-cpu VMs | 160GB bandwidth/month |
| Vercel (Frontend) | Unlimited | Perfect for frontend |

---

## 🚨 Common Issues

### Issue: "WebSocket connection failed"
**Solution:** Check if your server URL is correct and uses `wss://` (not `ws://`)

### Issue: "Peers not discovering each other"
**Solution:** 
1. Check server logs
2. Verify CORS settings
3. Test WebSocket connection manually

### Issue: "Server sleeps on Render"
**Solution:** Free tier apps sleep after 15min inactivity. Use Railway for always-on, or upgrade Render.

### Issue: "CORS errors"
**Solution:** Add your frontend URL to `ALLOWED_ORIGINS` environment variable

---

## 🎯 Next Steps

After deployment:

1. ✅ Test on 2+ different devices
2. ✅ Test on different networks (WiFi, mobile data)
3. ✅ Test file transfers
4. ✅ Monitor server logs
5. ✅ Share with friends for testing!

---

## 📝 Deployment Checklist

- [ ] Server deployed to Railway/Render/Fly.io
- [ ] Environment variables configured
- [ ] WebSocket URL obtained
- [ ] Client environment variables updated
- [ ] Client deployed to Vercel/Netlify
- [ ] Tested connection from 2+ devices
- [ ] Tested file transfer
- [ ] QR code scanning works
- [ ] Peer discovery works
- [ ] Server logs monitored

---

## 🆘 Need Help?

- Check server logs for errors
- Test WebSocket connection manually
- Verify environment variables
- Check CORS configuration
- Test on different networks

---

## 🎉 Success!

Once deployed, your Butterfly Drop app will be accessible from anywhere in the world!

Share your app URL with friends and test real peer-to-peer file sharing! 🦋