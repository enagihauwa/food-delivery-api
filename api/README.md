# Food Delivery API (NestJS)

The API service. Full documentation (endpoints, conventions, design decisions) is in the [root README](../README.md).

```bash
npm install                 # also generates the Prisma client
cp .env.example .env        # then edit DATABASE_URL
npx prisma migrate deploy   # create tables
npm run db:seed             # idempotent seed
npm run start:dev           # http://localhost:3000/api/v1/restaurants

npm test                    # unit tests
npm run test:e2e            # HTTP tests against TEST_DATABASE_URL
npm run lint
```
