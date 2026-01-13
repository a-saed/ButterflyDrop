#!/bin/bash

# Generate PWA icons from SVG favicon

set -e

echo "🎨 Generating PWA icons from favicon.svg..."

if ! command -v convert &> /dev/null; then
    echo "❌ ImageMagick not found. Installing..."
    echo "   Ubuntu/Debian: sudo apt install imagemagick"
    echo "   macOS: brew install imagemagick"
    exit 1
fi

cd "$(dirname "$0")/.."

if [ ! -f "public/favicon.svg" ]; then
    echo "❌ favicon.svg not found in public/"
    exit 1
fi

echo "📐 Generating 192x192 icon..."
convert -background none -resize 192x192 public/favicon.svg public/pwa-192x192.png

echo "📐 Generating 512x512 icon..."
convert -background none -resize 512x512 public/favicon.svg public/pwa-512x512.png

echo "✅ Icons generated successfully!"
echo "   - public/pwa-192x192.png"
echo "   - public/pwa-512x512.png"

