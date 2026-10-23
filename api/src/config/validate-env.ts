const POSITIVE_INTS = ['RATE_LIMIT_TTL_MS', 'RATE_LIMIT_MAX', 'PAGINATION_DEFAULT_LIMIT', 'PAGINATION_MAX_LIMIT', 'PORT'];

/** Fails fast at boot with a readable message instead of misbehaving later. */
export function validateEnv(env: Record<string, unknown>): Record<string, unknown> {
  const problems: string[] = [];

  if (typeof env.DATABASE_URL !== 'string' || !env.DATABASE_URL.startsWith('postgres')) {
    problems.push('DATABASE_URL must be a postgres connection string');
  }
  for (const key of POSITIVE_INTS) {
    const raw = env[key];
    if (raw === undefined || raw === '') continue;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1) problems.push(`${key} must be a positive integer (got ${JSON.stringify(raw)})`);
  }
  const def = Number(env.PAGINATION_DEFAULT_LIMIT ?? 20);
  const max = Number(env.PAGINATION_MAX_LIMIT ?? 100);
  if (def > max) problems.push('PAGINATION_DEFAULT_LIMIT must not exceed PAGINATION_MAX_LIMIT');

  if (problems.length) throw new Error(`Invalid environment:\n - ${problems.join('\n - ')}`);
  return env;
}
