# 🚨 CRITICAL: Render Build Command Fix

## The Problem
Render is **ignoring** your `render.yaml` file and using the default build command:
```
pnpm install --frozen-lockfile; pnpm run build
```

This fails because:
1. ❌ `--frozen-lockfile` requires a lockfile (Render can't find it)
2. ❌ Doesn't install devDependencies (TypeScript missing)
3. ❌ `@types/node` not found (TypeScript can't compile)

## ✅ SOLUTION: Manually Override Build Command

**You MUST do this in the Render dashboard - redeploying alone won't work!**

### Step-by-Step Instructions

1. **Go to Render Dashboard**
   - Visit: https://dashboard.render.com
   - Login if needed

2. **Open Your Service**
   - Click on `butterfly-drop-signaling` service

3. **Go to Settings**
   - Click **"Settings"** tab (top navigation)

4. **Find Build & Deploy Section**
   - Scroll down to **"Build & Deploy"** section

5. **Override Build Command**
   - Find the **"Build Command"** field
   - **DELETE** the existing value (if any)
   - **PASTE** this exact command:
     ```
     pnpm install --no-lockfile --include=dev && pnpm build
     ```
   - ⚠️ **IMPORTANT**: Make sure there are no extra spaces or line breaks

6. **Save Changes**
   - Click **"Save Changes"** button at the bottom
   - Wait for confirmation

7. **Verify the Change**
   - Scroll back to "Build & Deploy" section
   - Confirm the Build Command shows your new command
   - It should show: `pnpm install --no-lockfile --include=dev && pnpm build`

8. **Deploy**
   - Go to **"Manual Deploy"** tab
   - Click **"Deploy latest commit"**
   - Or click **"Events"** tab and trigger a new deploy

### What This Command Does

- `pnpm install --no-lockfile` - Installs packages without requiring lockfile
- `--include=dev` - **CRITICAL**: Installs devDependencies (TypeScript, @types/node)
- `&& pnpm build` - Runs TypeScript compiler

### Expected Build Output

After fixing, you should see:
```
✅ Installing dependencies...
✅ Installing devDependencies...
✅ Running tsc...
✅ Build successful!
```

### If It Still Doesn't Work

1. **Double-check** the Build Command field shows the correct command
2. **Check Root Directory** is set to `server` in Settings
3. **Try deleting and recreating** the service (will use render.yaml automatically)

---

## Alternative: Delete & Recreate Service

If manual override doesn't work:

1. **Delete** the existing service in Render dashboard
2. **Create New Web Service**
3. **Connect GitHub** repository
4. Render should **automatically detect** `render.yaml` and use correct build command
5. **Verify** in Settings that build command is correct before first deploy

