# 🚀 Quick SEO Setup Guide

## ✅ What's Already Done

All SEO optimizations are implemented! Your app is ready for search engines.

## 🔧 Important: Update Your Domain

**Before deploying**, update these URLs to match your actual domain:

### Files to Update:

1. **`index.html`** - Replace `butterfly-drop.vercel.app` with your domain:
   - Line: `<meta property="og:url" content="YOUR_DOMAIN" />`
   - Line: `<meta name="twitter:url" content="YOUR_DOMAIN" />`
   - Line: `<link rel="canonical" href="YOUR_DOMAIN" />`
   - Line: JSON-LD `"url"` fields

2. **`public/sitemap.xml`** - Update the URL:
   - Line: `<loc>YOUR_DOMAIN</loc>`

3. **`public/robots.txt`** - Update sitemap reference:
   - Line: `Sitemap: YOUR_DOMAIN/sitemap.xml`

### Quick Find & Replace

If your domain is `https://your-app.com`, run:

```bash
# Find all occurrences
grep -r "butterfly-drop.vercel.app" .

# Replace (example with sed)
find . -type f -name "*.html" -o -name "*.xml" -o -name "*.txt" | xargs sed -i 's/butterfly-drop.vercel.app/your-app.com/g'
```

## 📋 Next Steps After Deployment

1. **Submit to Google Search Console**
   - Go to [Google Search Console](https://search.google.com/search-console)
   - Add your property
   - Submit sitemap: `https://your-domain.com/sitemap.xml`

2. **Submit to Bing Webmaster Tools**
   - Go to [Bing Webmaster Tools](https://www.bing.com/webmasters)
   - Add your site
   - Submit sitemap

3. **Verify robots.txt**
   - Visit: `https://your-domain.com/robots.txt`
   - Should show your robots.txt content

4. **Verify sitemap**
   - Visit: `https://your-domain.com/sitemap.xml`
   - Should show your sitemap XML

5. **Test Meta Tags**
   - Use [Facebook Sharing Debugger](https://developers.facebook.com/tools/debug/)
   - Use [Twitter Card Validator](https://cards-dev.twitter.com/validator)
   - Use [LinkedIn Post Inspector](https://www.linkedin.com/post-inspector/)

## 🎯 Target Keywords (Already Optimized)

Your app is optimized for:
- ✅ file sharing
- ✅ p2p file transfer
- ✅ peer to peer file sharing
- ✅ WebRTC file sharing
- ✅ private file sharing
- ✅ secure file transfer
- ✅ snapdrop alternative
- ✅ toffeeshare alternative

## 📊 Monitor Your SEO

After deployment, monitor:
- Google Search Console (indexing status)
- Google Analytics (traffic sources)
- Lighthouse score (aim for 90+)
- PageSpeed Insights

## 🚀 Boost Rankings

1. **Get Backlinks**
   - Submit to Product Hunt
   - Post on Hacker News
   - Share on Reddit (r/selfhosted, r/privacy)
   - List on AlternativeTo.net

2. **Create Content**
   - Blog posts about file sharing
   - Tutorials and guides
   - Comparison articles

3. **Social Sharing**
   - Share on Twitter/X
   - Post on LinkedIn
   - Create demo videos

## ✅ Checklist

- [ ] Update domain URLs in all files
- [ ] Deploy to production
- [ ] Submit sitemap to Google Search Console
- [ ] Submit sitemap to Bing Webmaster Tools
- [ ] Verify robots.txt is accessible
- [ ] Test Open Graph tags
- [ ] Test Twitter Cards
- [ ] Monitor Google Search Console
- [ ] Set up Google Analytics (optional)

## 📚 More Info

See `SEO.md` for detailed SEO documentation and best practices.

