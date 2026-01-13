# 🚀 Deployment Guide

This guide covers deploying Butterfly Drop to production.

## 🎯 Recommended Setup: Vercel (Frontend) + Render (Backend)

This is the **recommended** combination for best performance and ease of use.

### Why This Combo?

- ✅ **Vercel**: Excellent for frontend, automatic HTTPS, CDN, fast builds
- ✅ **Render**: Simple WebSocket support, free tier available, easy config
- ✅ **Both free tiers** are generous for MVP
- ✅ **Easy to set up** with minimal configuration

---

## 📦 Option 1: Vercel + Render (Recommended)

### Step 1: Deploy Backend to Render

1. **Push code to GitHub** (if not already)
   ```bash
   git add .
   git commit -m "Ready for deployment"
   git push origin main
   ```

2. **Go to [render.com](https://render.com)** and sign up/login

3. **Create New Web Service**
   - Click "New +" → "Web Service"
   - Connect your GitHub repository
   - Select the repository

4. **Configure Service**
   
   **Option A: Using render.yaml (Recommended)**
   - The `render.yaml` file in the root directory is automatically detected
   - Just connect your GitHub repo and Render will use the configuration
   - No manual configuration needed!
   
   **Option B: Manual Configuration**
   - **Name**: `butterfly-drop-signaling`
   - **Root Directory**: `server` ⚠️ **IMPORTANT**: Must be set to `server`
   - **Environment**: `Node`
   - **Build Command**: `pnpm install --no-frozen-lockfile && pnpm build`
   - **Start Command**: `pnpm start`
   - **Plan**: Free (or paid for better performance)
   - **Note**: If you get lockfile errors, ensure `server/pnpm-lock.yaml` is committed to git

5. **Set Environment Variables**
   - `NODE_ENV` = `production`
   - `PORT` = `8080` (Render sets this automatically, but good to have)
   - `ALLOWED_ORIGINS` = (leave empty for now, we'll set after frontend deploy)

6. **Deploy**
   - Click "Create Web Service"
   - Wait for deployment (~2-3 minutes)
   - Copy the URL: `https://butterfly-drop-signaling.onrender.com`

### Step 2: Deploy Frontend to Vercel

1. **Go to [vercel.com](https://vercel.com)** and sign up/login

2. **Import Project**
   - Click "Add New..." → "Project"
   - Import your GitHub repository

3. **Configure Project**
   - **Framework Preset**: Vite
   - **Root Directory**: `./` (root)
   - **Build Command**: `pnpm build`
   - **Output Directory**: `dist`
   - **Install Command**: `pnpm install`

4. **Set Environment Variables**
   - `VITE_SIGNALING_URL` = `wss://butterfly-drop-signaling.onrender.com`
   - (Replace with your actual Render URL, change `https` to `wss`)

5. **Deploy**
   - Click "Deploy"
   - Wait for build (~1-2 minutes)
   - Your app will be live at: `https://your-project.vercel.app`

### Step 3: Update CORS

1. **Go back to Render dashboard**
2. **Edit Environment Variables**
3. **Set `ALLOWED_ORIGINS`** = `https://your-project.vercel.app`
4. **Redeploy** (Render will auto-redeploy)

### Step 4: Test

1. Open your Vercel URL
2. Create a session
3. Open on another device
4. Test file transfer!

---

## 📦 Option 2: Railway (All-in-One)

**Simpler** - deploy both frontend and backend on one platform.

### Backend on Railway

1. Go to [railway.app](https://railway.app)
2. New Project → Deploy from GitHub
3. Select repository
4. Add service → Select `server` folder
5. Set environment variables:
   - `NODE_ENV` = `production`
   - `PORT` = `8080`
6. Deploy → Copy URL: `https://your-app.railway.app`

### Frontend on Railway

1. Add another service → Select root folder
2. Configure:
   - **Build Command**: `pnpm install && pnpm build`
   - **Start Command**: `npx serve -s dist -p $PORT`
3. Set environment:
   - `VITE_SIGNALING_URL` = `wss://your-backend.railway.app`
4. Deploy

**Note**: Railway frontend requires installing `serve`: `pnpm add -D serve`

---

## 📦 Option 3: Fly.io (WebSocket Optimized)

**Best for WebSocket performance** - optimized for real-time apps.

### Backend on Fly.io

1. Install Fly CLI: `curl -L https://fly.io/install.sh | sh`
2. Login: `fly auth login`
3. Initialize: `cd server && fly launch`
4. Follow prompts, deploy: `fly deploy`
5. Get URL: `https://your-app.fly.dev`

### Frontend on Vercel

Same as Option 1, Step 2, but use Fly.io URL for signaling.

---

## 🔧 Environment Variables Reference

### Backend (Signaling Server)

```env
NODE_ENV=production
PORT=8080
ALLOWED_ORIGINS=https://your-frontend-domain.com
```

### Frontend (Client)

```env
VITE_SIGNALING_URL=wss://your-signaling-server.com
```

**Important**: Use `wss://` (secure WebSocket) for production, not `ws://`

---

## ✅ Post-Deployment Checklist

- [ ] Backend deployed and accessible
- [ ] Frontend deployed and accessible
- [ ] Environment variables set correctly
- [ ] CORS configured (ALLOWED_ORIGINS)
- [ ] Test file transfer between devices
- [ ] Test on mobile devices
- [ ] Verify PWA install works
- [ ] Check HTTPS/SSL certificates (should be automatic)

---

## 🐛 Troubleshooting

### WebSocket Connection Fails

- Check URL uses `wss://` not `ws://`
- Verify CORS settings on backend
- Check browser console for errors
- Ensure backend is running and accessible

### Frontend Can't Connect

- Verify `VITE_SIGNALING_URL` is correct
- Check environment variable is set in deployment platform
- Rebuild frontend after changing env vars

### CORS Errors

- Add frontend URL to `ALLOWED_ORIGINS` on backend
- Redeploy backend after changing CORS

---

## 💰 Cost Comparison

| Platform | Free Tier | Paid Tier |
|----------|-----------|-----------|
| **Vercel** | ✅ Generous | $20/mo (Pro) |
| **Render** | ✅ 750 hrs/mo | $7/mo (Starter) |
| **Railway** | ❌ $5 credit | $5/mo + usage |
| **Fly.io** | ✅ 3 VMs | Pay as you go |

**Recommendation**: Start with Vercel + Render (both free), upgrade if needed.

---

## 🚀 Quick Deploy Commands

### Render (Backend)
```bash
cd server
# Already configured with render.yaml
# Just connect GitHub repo in Render dashboard
```

### Vercel (Frontend)
```bash
# Install Vercel CLI (optional)
npm i -g vercel

# Deploy
vercel

# Or use GitHub integration (recommended)
```

---

## 📚 Additional Resources

- [Vercel Documentation](https://vercel.com/docs)
- [Render Documentation](https://render.com/docs)
- [Railway Documentation](https://docs.railway.app)
- [Fly.io Documentation](https://fly.io/docs)

---

**Ready to deploy?** Start with **Option 1: Vercel + Render** for the smoothest experience! 🎉

