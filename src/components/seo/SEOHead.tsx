import { useEffect } from 'react';

interface SEOHeadProps {
  title?: string;
  description?: string;
  keywords?: string;
  image?: string;
  url?: string;
}

/**
 * Component to dynamically update SEO meta tags for React SPA
 * Use this for any future pages/routes that need different meta tags
 */
export function SEOHead({
  title = 'Butterfly Drop - Fast, Private P2P File Sharing',
  description = 'Share files directly between devices. Fast, private, peer-to-peer file sharing via WebRTC. No cloud storage, no accounts, end-to-end encrypted.',
  keywords = 'file sharing, p2p file transfer, peer to peer, WebRTC file sharing, private file sharing, secure file transfer',
  image = 'https://butterfly-drop.vercel.app/pwa-512x512.png',
  url = 'https://butterfly-drop.vercel.app/',
}: SEOHeadProps) {
  useEffect(() => {
    // Update title
    document.title = title;

    // Update or create meta tags
    const updateMetaTag = (name: string, content: string, isProperty = false) => {
      const attribute = isProperty ? 'property' : 'name';
      let meta = document.querySelector(`meta[${attribute}="${name}"]`) as HTMLMetaElement;
      
      if (!meta) {
        meta = document.createElement('meta');
        meta.setAttribute(attribute, name);
        document.head.appendChild(meta);
      }
      
      meta.content = content;
    };

    // Primary meta tags
    updateMetaTag('title', title);
    updateMetaTag('description', description);
    updateMetaTag('keywords', keywords);

    // Open Graph tags
    updateMetaTag('og:title', title, true);
    updateMetaTag('og:description', description, true);
    updateMetaTag('og:image', image, true);
    updateMetaTag('og:url', url, true);

    // Twitter Card tags
    updateMetaTag('twitter:title', title);
    updateMetaTag('twitter:description', description);
    updateMetaTag('twitter:image', image);
    updateMetaTag('twitter:url', url);

    // Update canonical link
    let canonical = document.querySelector('link[rel="canonical"]') as HTMLLinkElement;
    if (!canonical) {
      canonical = document.createElement('link');
      canonical.rel = 'canonical';
      document.head.appendChild(canonical);
    }
    canonical.href = url;
  }, [title, description, keywords, image, url]);

  return null; // This component doesn't render anything
}

