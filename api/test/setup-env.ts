import 'dotenv/config';

// Every e2e worker talks to the test database, never the dev one.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.NODE_ENV = 'test';
// Generous default so ordinary tests are not throttled; the rate-limit test sets its own.
process.env.RATE_LIMIT_MAX = '100000';
