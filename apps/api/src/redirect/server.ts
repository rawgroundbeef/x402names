import { Hono } from 'hono';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import { eq } from 'drizzle-orm';
import { domains } from '../db/schema';
import type { DomainCache } from './cache';

export function createRedirectApp(db: BunSQLiteDatabase<any>, cache: DomainCache) {
  const app = new Hono({
    // Use host header to route requests by domain
    getPath: (req) => {
      const url = new URL(req.url);
      // Extract host without port (important for development)
      const host = (req.headers.get('host') || url.hostname).split(':')[0];
      return '/' + host + url.pathname;
    },
  });

  // ACME challenge route for SSL provisioning (placeholder for future)
  app.get('/.well-known/acme-challenge/:token', (c) => {
    return c.json({ error: 'ACME challenge not yet implemented' }, 404);
  });

  // Handle domain requests (must have at least one dot to be a valid domain)
  app.get('/:domain{.+\\..+}/*', async (c) => {
    // Extract domain from path (first segment after /)
    const fullPath = c.req.path;
    const pathParts = fullPath.substring(1).split('/');
    const domain = pathParts[0];
    const subpath = '/' + pathParts.slice(1).join('/');

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
          // Cache the targetUrl and proceed to redirect
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

    // Perform 301 redirect, preserving path and query string
    try {
      const redirectUrl = new URL(targetUrl);
      // Preserve the subpath (everything after the domain)
      if (subpath !== '/') {
        redirectUrl.pathname = subpath;
      }
      // Preserve query string
      const originalUrl = new URL(c.req.url);
      redirectUrl.search = originalUrl.search;

      return c.redirect(redirectUrl.toString(), 301);
    } catch (error) {
      // Invalid targetUrl stored in database
      return c.html(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Configuration Error</title>
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
    <h1>Configuration Error</h1>
    <p>The target URL for this domain is invalid.</p>
  </div>
</body>
</html>
      `, 500);
    }
  });

  // Root endpoint for requests without a valid domain pattern
  app.get('/', (c) => {
    return c.json({
      service: 'x402names-redirect',
      message: 'Multi-domain redirect server',
    });
  });

  return app;
}
