import 'dotenv/config';
import { execSync } from 'node:child_process';

/** Migrate and seed the dedicated test database once before the e2e suite. */
export default function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL is not set (see .env.example)');
  if (url === process.env.DATABASE_URL) throw new Error('TEST_DATABASE_URL must differ from DATABASE_URL');

  const env = { ...process.env, DATABASE_URL: url };
  execSync('npx prisma migrate deploy', { env, stdio: 'inherit' });
  execSync('npx prisma db seed', { env, stdio: 'inherit' });
}
