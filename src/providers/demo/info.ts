// A stand-in provider for development: it runs on the dev server under another origin (127.0.0.1
// instead of localhost) and serves the sample household, so the whole bookmarklet flow can be tried
// without an account at a real supplier. Only listed while running `npm run dev`.
export const demo = {
  id: 'demo',
  name: 'Demo supplier',
  origin: 'http://127.0.0.1:5173',
  loginUrl: 'http://127.0.0.1:5173/',
};
