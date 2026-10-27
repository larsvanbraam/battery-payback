// Fills %SITE_URL% in index.html with the site's absolute origin, because share previews (og:image,
// og:url) only work with full URLs. Set SITE_URL to choose it; on Vercel it defaults to the project's
// production domain, and in development to the dev server's own address.
import type { Plugin } from 'vite';

export function siteUrl(): Plugin {
  let url = '';
  return {
    name: 'site-url',
    configResolved(config) {
      const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
      const dev = `http://${config.server.host ?? 'localhost'}:${config.server.port ?? 5173}`;
      url = (process.env.SITE_URL ?? (vercel ? `https://${vercel}` : dev)).replace(/\/$/, '');
    },
    transformIndexHtml: (html) => html.replaceAll('%SITE_URL%', url),
  };
}
