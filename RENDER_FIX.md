# 🔧 Render Build Fix

## Problem
Render is using the default build command instead of the one from `render.yaml`. This causes:
- Lockfile errors (`--frozen-lockfile` when lockfile is missing)
- Missing `@types/node` (TypeScript can't find Node.js types)

## Solution

### Option 1: Update Build Command in Render Dashboard (Quickest)

1. Go to your Render dashboard: https://dashboard.render.com
2. Click on your `butterfly-drop-signaling` service
3. Go to **Settings** → **Build & Deploy**
4. **Override** the build command with:
   ```
   pnpm install --no-frozen-lockfile --include=dev && pnpm build
   ```
5. Click **Save Changes**
6. Click **Manual Deploy** → **Deploy latest commit**

### Option 2: Delete and Recreate Service (Uses render.yaml)

1. Go to your Render dashboard
2. Delete the existing `butterfly-drop-signaling` service
3. Create a new Web Service
4. Connect your GitHub repository
5. Render should automatically detect `render.yaml` and use the correct build command
6. Verify the build command shows: `pnpm install --no-frozen-lockfile --include=dev && pnpm build`

### Option 3: Use Blueprint (render.yaml)

If you're creating a new service:
1. In Render dashboard, click **New +** → **Blueprint**
2. Connect your GitHub repository
3. Render will automatically detect and use `render.yaml`

## Why This Happens

- Render services created before `render.yaml` existed don't automatically pick it up
- You need to either manually update the build command or recreate the service
- The `--include=dev` flag ensures TypeScript is installed (needed for `tsc` build)

## Verification

After updating, the build should:
1. ✅ Install dependencies including `@types/node`
2. ✅ Install devDependencies including `typescript`
3. ✅ Run `tsc` successfully
4. ✅ Start the server with `pnpm start`

