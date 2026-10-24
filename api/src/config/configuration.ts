const int = (value: string | undefined, fallback: number): number => {
  if (value === undefined || value === '') return fallback;
  return Number(value);
};

/** Single source of truth for every tunable number. Handlers never hard-code limits. */
export default () => ({
  env: process.env.NODE_ENV ?? 'development',
  port: int(process.env.PORT, 3000),
  databaseUrl: process.env.DATABASE_URL ?? '',
  // How many reverse proxies sit in front of the app (X-Forwarded-For hops to skip from the right).
  // Defaults to 1, or 3 on Render (client, Cloudflare, Render router) which sets RENDER=true.
  trustProxyHops: int(process.env.TRUST_PROXY_HOPS, process.env.RENDER === 'true' ? 3 : 1),
  corsOrigins: (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),
  rateLimit: {
    ttlMs: int(process.env.RATE_LIMIT_TTL_MS, 60_000),
    limit: int(process.env.RATE_LIMIT_MAX, 100),
  },
  pagination: {
    defaultLimit: int(process.env.PAGINATION_DEFAULT_LIMIT, 20),
    maxLimit: int(process.env.PAGINATION_MAX_LIMIT, 100),
  },
});

export type AppConfig = ReturnType<typeof import('./configuration.js').default>;
