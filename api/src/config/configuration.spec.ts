import configuration from './configuration.js';

describe('configuration corsOrigins', () => {
  const original = process.env.CORS_ORIGINS;
  afterEach(() => {
    if (original === undefined) delete process.env.CORS_ORIGINS;
    else process.env.CORS_ORIGINS = original;
  });

  it('strips trailing slashes and whitespace, and skips empty entries', () => {
    process.env.CORS_ORIGINS = ' https://a.vercel.app/ , https://b.vercel.app,, http://localhost:5173// ';
    expect(configuration().corsOrigins).toEqual(['https://a.vercel.app', 'https://b.vercel.app', 'http://localhost:5173']);
  });
  it('is empty when unset', () => {
    delete process.env.CORS_ORIGINS;
    expect(configuration().corsOrigins).toEqual([]);
  });
});
