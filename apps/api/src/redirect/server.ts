import { Hono } from 'hono';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import { eq } from 'drizzle-orm';
import { domains } from '../db/schema';
import type { DomainCache } from './cache';
import type { ContentCache } from './content-cache';

const FETCH_TIMEOUT_MS = 10_000;

export function createRedirectApp(db: BunSQLiteDatabase<any>, cache: DomainCache, contentCache: ContentCache) {
  const app = new Hono({
    // Use host header to route requests by domain
    getPath: (req) => {
      const url = new URL(req.url);
      // Extract host without port (important for development)
      const host = (req.headers.get('host') || url.hostname).split(':')[0];
      return '/' + host + url.pathname;
    },
  });

  // Main redirect handler - handle all domain requests
  app.all('/:domain{.+\\..+}/*', async (c) => {
    // Extract domain and path from the modified path (host/path format from getPath)
    const fullPath = c.req.path;
    const pathParts = fullPath.substring(1).split('/');
    const domain = pathParts[0];
    const subpath = '/' + pathParts.slice(1).join('/');

    // Handle ACME challenge requests (for SSL provisioning - placeholder for future)
    if (subpath.startsWith('/.well-known/acme-challenge/')) {
      return c.json({ error: 'ACME challenge not yet implemented' }, 404);
    }

    // Check cache first
    let targetUrl = cache.get(domain);

    // On cache miss, query database
    if (!targetUrl) {
      const domainRecord = await db
        .select()
        .from(domains)
        .where(eq(domains.name, domain))
        .get();

      if (domainRecord) {
        if ((domainRecord.status === 'live' || domainRecord.status === 'registered') && domainRecord.targetUrl) {
          // Cache the targetUrl and proceed to proxy
          targetUrl = domainRecord.targetUrl;
          cache.set(domain, targetUrl);
        } else {
          // Domain registered but no targetUrl configured
          return c.html(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${domain} - Not Configured</title>
  <style>
    body {
      font-family: system-ui, -apple-system, sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      margin: 0;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      text-align: center;
      padding: 20px;
    }
    .container {
      max-width: 600px;
    }
    h1 {
      font-size: 2.5rem;
      margin-bottom: 1rem;
    }
    p {
      font-size: 1.2rem;
      opacity: 0.9;
    }
    .domain {
      font-weight: bold;
      font-size: 1.4rem;
      margin: 1rem 0;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>Domain Registered</h1>
    <div class="domain">${domain}</div>
    <p>This domain is registered but not configured yet.</p>
    <p>The owner needs to set a target URL for forwarding.</p>
  </div>
</body>
</html>
          `, 200);
        }
      } else {
        // Domain not found in database - show landing page
        return c.html(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${domain} - Available for Registration</title>
  <style>
    body {
      font-family: system-ui, -apple-system, sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      margin: 0;
      background: linear-gradient(135deg, #00c6ff 0%, #0072ff 100%);
      color: white;
      text-align: center;
      padding: 20px;
    }
    .container {
      max-width: 600px;
    }
    h1 {
      font-size: 2.5rem;
      margin-bottom: 1rem;
    }
    p {
      font-size: 1.2rem;
      opacity: 0.9;
      margin-bottom: 1rem;
    }
    .domain {
      font-weight: bold;
      font-size: 1.4rem;
      margin: 1rem 0;
      background: rgba(255, 255, 255, 0.2);
      padding: 1rem;
      border-radius: 8px;
    }
    a {
      color: white;
      text-decoration: underline;
      font-weight: bold;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>Domain Available</h1>
    <div class="domain">${domain}</div>
    <p>This domain is available for registration through x402names.</p>
    <p>Register it with a single API call and USDC payment.</p>
    <p><a href="https://github.com/x402/names" target="_blank">Learn more about x402names</a></p>
  </div>
</body>
</html>
        `, 200);
      }
    }

    // Proxy the upstream content instead of redirecting
    try {
      const upstreamUrl = new URL(targetUrl);
      // Preserve the subpath (everything after the domain)
      if (subpath !== '/') {
        upstreamUrl.pathname = subpath;
      }
      // Preserve query string
      const originalUrl = new URL(c.req.url);
      upstreamUrl.search = originalUrl.search;

      const cacheKey = domain + subpath + originalUrl.search;

      // Check content cache first
      const cached = contentCache.get(cacheKey);
      if (cached) {
        return new Response(cached.body, {
          status: cached.statusCode,
          headers: {
            'Content-Type': cached.contentType,
            'Cache-Control': 'public, max-age=300',
          },
        });
      }

      // Fetch upstream content
      const upstreamResponse = await fetch(upstreamUrl.toString(), {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: {
          'Accept': c.req.header('Accept') || '*/*',
          'Accept-Encoding': 'identity',
        },
      });

      const body = Buffer.from(await upstreamResponse.arrayBuffer());
      const contentType = upstreamResponse.headers.get('Content-Type') || 'application/octet-stream';

      // Cache the response
      contentCache.set(cacheKey, {
        body,
        contentType,
        statusCode: upstreamResponse.status,
      });

      return new Response(body, {
        status: upstreamResponse.status,
        headers: {
          'Content-Type': contentType,
          'Cache-Control': 'public, max-age=300',
        },
      });
    } catch (error) {
      // Upstream fetch failed - serve 503 error page
      return c.html(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Service Unavailable</title>
  <style>
    body {
      font-family: system-ui, -apple-system, sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      margin: 0;
      background: #f44336;
      color: white;
      text-align: center;
      padding: 20px;
    }
  </style>
</head>
<body>
  <div>
    <h1>Service Unavailable</h1>
    <p>The upstream content could not be fetched. Please try again later.</p>
  </div>
</body>
</html>
      `, 503);
    }
  });

  // Catch-all for requests that don't match domain pattern (localhost, IPs, etc)
  app.get('/*', (c) => {
    return c.json({
      service: 'x402names-redirect',
      message: 'Multi-domain redirect server',
    });
  });

  return app;
}
