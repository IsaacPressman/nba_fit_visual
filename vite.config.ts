import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Link previews (Slack, iMessage, X, Facebook) only load an image from an
 * absolute URL, and search engines want an absolute canonical address and
 * sitemap — none of which is known until the site is deployed. Build with
 * SITE_URL set — `SITE_URL=https://example.com npm run build` — and the preview
 * image, og:url, canonical link, structured-data url and sitemap all point at
 * the deployed site; without it they stay relative or are left out, which is
 * right for local development and wrong for sharing or search.
 */
function siteUrl(): Plugin {
  const site = process.env.SITE_URL?.replace(/\/+$/, '')
  return {
    name: 'site-url',
    transformIndexHtml(html) {
      if (!site) return html
      return html
        .replace(/(<meta (?:property="og:image"|name="twitter:image") content=")og\.png"/g, `$1${site}/og.png"`)
        .replace('"@type": "WebApplication",', `"@type": "WebApplication",\n        "url": "${site}/",`)
        .replace(
          '</head>',
          `  <meta property="og:url" content="${site}/" />\n    <link rel="canonical" href="${site}/" />\n  </head>`,
        )
    },
    // Routing is in the hash, so the front page is the only address to list.
    generateBundle() {
      const robots = ['User-agent: *', 'Allow: /']
      if (site) {
        robots.push('', `Sitemap: ${site}/sitemap.xml`)
        this.emitFile({
          type: 'asset',
          fileName: 'sitemap.xml',
          source: [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
            `  <url><loc>${site}/</loc><lastmod>${new Date().toISOString().slice(0, 10)}</lastmod></url>`,
            '</urlset>',
            '',
          ].join('\n'),
        })
      }
      this.emitFile({ type: 'asset', fileName: 'robots.txt', source: robots.join('\n') + '\n' })
    },
  }
}

export default defineConfig({
  // Relative asset paths, so the build works at a domain root and under a
  // sub-path alike (a GitHub Pages project site lives at /<repo>/). Routing is
  // in the hash, so no page ever needs an absolute path.
  base: './',
  plugins: [react(), siteUrl()],
  server: { open: true },
})
