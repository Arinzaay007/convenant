import { handle } from './covenant-server.mjs';

// API functions always set their own fixed route, regardless of how Vercel
// represents request.url. Preserve the caller's query string for read-only
// capacity checks and catalog refresh; never trust a query to select a route.
export function vercelHandler(route) {
  return function handleVercelRequest(req, res) {
    const url = new URL(req.url || '/', 'https://localhost');
    req.url = `${route}${url.search}`;
    return handle(req, res);
  };
}
