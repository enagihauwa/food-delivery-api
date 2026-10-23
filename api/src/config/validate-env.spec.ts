import { validateEnv } from './validate-env.js';

describe('validateEnv', () => {
  const ok = { DATABASE_URL: 'postgresql://u:p@localhost:5432/db' };

  it('accepts a minimal valid env', () => {
    expect(() => validateEnv(ok)).not.toThrow();
  });
  it('rejects a missing or non-postgres DATABASE_URL', () => {
    expect(() => validateEnv({})).toThrow(/DATABASE_URL/);
    expect(() => validateEnv({ DATABASE_URL: 'mysql://x' })).toThrow(/DATABASE_URL/);
  });
  it('rejects non-numeric or non-positive numbers', () => {
    expect(() => validateEnv({ ...ok, RATE_LIMIT_MAX: 'abc' })).toThrow(/RATE_LIMIT_MAX/);
    expect(() => validateEnv({ ...ok, PAGINATION_MAX_LIMIT: '0' })).toThrow(/PAGINATION_MAX_LIMIT/);
  });
  it('rejects a default limit above the max', () => {
    expect(() => validateEnv({ ...ok, PAGINATION_DEFAULT_LIMIT: '200' })).toThrow(/must not exceed/);
  });
});
