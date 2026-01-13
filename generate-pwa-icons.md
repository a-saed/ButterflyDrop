# 🎨 Generate PWA Icons

The PWA needs PNG icons for better compatibility. You can generate them from the SVG favicon.

## Option 1: Using ImageMagick (Recommended)

```bash
# Install ImageMagick if needed
# Ubuntu/Debian: sudo apt install imagemagick
# macOS: brew install imagemagick

# Generate icons from SVG
convert -background none -resize 192x192 public/favicon.svg public/pwa-192x192.png
convert -background none -resize 512x512 public/favicon.svg public/pwa-512x512.png
```

## Option 2: Using Online Tools

1. Go to https://realfavicongenerator.net/ or https://www.pwabuilder.com/imageGenerator
2. Upload `public/favicon.svg`
3. Download generated icons
4. Place `pwa-192x192.png` and `pwa-512x512.png` in `public/` folder

## Option 3: Using Node.js (sharp)

```bash
# Install sharp
npm install --save-dev sharp

# Create generate-icons.js
node -e "
const sharp = require('sharp');
sharp('public/favicon.svg')
  .resize(192, 192)
  .png()
  .toFile('public/pwa-192x192.png');
sharp('public/favicon.svg')
  .resize(512, 512)
  .png()
  .toFile('public/pwa-512x512.png');
"
```

## Note

The app will work with just the SVG favicon, but PNG icons provide better compatibility across all devices and platforms.

