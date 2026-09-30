import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Link previews (Slack, iMessage, X, Facebook) only load an image from an
 * absolute URL, and the address is not known until the site is deployed. Build
 * with SITE_URL set — `SITE_URL=https://example.com npm run build` — and the
 * preview tags point at the deployed image; without it they stay relative,
 * which is right for local development and wrong for sharing.
 */
function absoluteSocialImage(): Plugin {
  return {
    name: 'absolute-social-image',
    transformIndexHtml(html) {
      const site = process.env.SITE_URL?.replace(/\/+$/, '')
      if (!site) return html
      return html
        .replace(/(<meta (?:property="og:image"|name="twitter:image") content=")og\.png"/g, `$1${site}/og.png"`)
        .replace('</head>', `  <meta property="og:url" content="${site}/" />\n  </head>`)
    },
  }
}

export default defineConfig({
  // Relative asset paths, so the build works at a domain root and under a
  // sub-path alike (a GitHub Pages project site lives at /<repo>/). Routing is
  // in the hash, so no page ever needs an absolute path.
  base: './',
  plugins: [react(), absoluteSocialImage()],
  server: { open: true },
})
