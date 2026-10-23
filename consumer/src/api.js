import { buildQuery } from './lib.js';

/** Everything that can go wrong calling the API, normalised. */
export class ApiError extends Error {
  constructor({ kind, status = null, code = null, message, retryAfter = null }) {
    super(message);
    this.name = 'ApiError';
    this.kind = kind; // 'network' | 'http'
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

/**
 * Minimal client for the Food Delivery API.
 * `get` resolves with the parsed `{ data, meta? }` envelope or throws ApiError.
 */
export function createClient(baseUrl, fetchImpl = (...args) => fetch(...args)) {
  const root = baseUrl.replace(/\/+$/, '');

  async function get(path, params, { signal } = {}) {
    let response;
    try {
      response = await fetchImpl(`${root}${path}${buildQuery(params)}`, { headers: { Accept: 'application/json' }, signal });
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      throw new ApiError({ kind: 'network', message: 'Network request failed' });
    }

    let body = null;
    try {
      body = await response.json();
    } catch {
      /* non-JSON body: handled below */
    }

    if (!response.ok) {
      const retryAfter = Number(response.headers?.get?.('Retry-After')) || null;
      throw new ApiError({
        kind: 'http',
        status: response.status,
        code: body?.error?.code ?? null,
        message: body?.error?.message ?? `Request failed (${response.status})`,
        retryAfter,
      });
    }
    if (!body || !('data' in body)) {
      throw new ApiError({ kind: 'http', status: response.status, message: 'Unexpected response from the server' });
    }
    return body;
  }

  return { get, baseUrl: root };
}
