// Four paths, read and written with the History API. Old hash links (#sample, #import=<id>) still work:
// they are read as their path and the address bar is rewritten. Vercel serves index.html for every path
// (vercel.json), so a reload or a shared link lands here too.
export type Route =
  | { name: 'start' }
  | { name: 'sample' }
  | { name: 'results' }
  | { name: 'import'; provider: string };

export const paths = {
  start: '/',
  sample: '/sample',
  results: '/results',
  import: (provider: string) => `/import/${provider}`,
};

export function toPath(route: Route): string {
  return route.name === 'import' ? paths.import(route.provider) : paths[route.name];
}

export function parseRoute(pathname: string, hash = ''): Route {
  if (hash === '#sample') return { name: 'sample' };
  const legacyImport = hash.match(/^#import=([a-z0-9-]+)$/);
  if (legacyImport) return { name: 'import', provider: legacyImport[1] };
  const path = pathname.replace(/\/+$/, '') || '/';
  if (path === paths.sample) return { name: 'sample' };
  if (path === paths.results) return { name: 'results' };
  const imported = path.match(/^\/import\/([a-z0-9-]+)$/);
  if (imported) return { name: 'import', provider: imported[1] };
  return { name: 'start' };
}

/** The route in the address bar, with an old hash link rewritten to its path. */
export function currentRoute(): Route {
  const route = parseRoute(location.pathname, location.hash);
  const path = toPath(route);
  if (location.pathname !== path || (location.hash && /^#(sample|import=)/.test(location.hash))) {
    history.replaceState(null, '', path + location.search);
  }
  return route;
}

let listener: (route: Route) => void = () => {};

/** Moves to a route; `replace` swaps the current entry instead of adding one to Back. */
export function navigate(route: Route, { replace = false } = {}) {
  const path = toPath(route) + location.search;
  if (replace) history.replaceState(null, '', path);
  else if (location.pathname !== toPath(route)) history.pushState(null, '', path);
  listener(route);
}

export function onRoute(fn: (route: Route) => void) {
  listener = fn;
  window.addEventListener('popstate', () => fn(parseRoute(location.pathname)));
}

// Links to a place on the same screen ("#get-data") scroll there without touching the address bar.
export function bindInPageLinks() {
  document.addEventListener('click', (ev) => {
    const link = (ev.target as Element | null)?.closest?.('a[href^="#"]');
    const id = link?.getAttribute('href')?.slice(1);
    const target = id ? document.getElementById(id) : null;
    if (!target) return;
    ev.preventDefault();
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}
