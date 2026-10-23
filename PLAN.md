# Execution Plan: Build and Serve a Consumable API

Budget: 12–16 hours. Target band: **Excellent** (cursor pagination with the tradeoff explained, everything configurable, README sufficient on its own, consumer handles empty and error states).

## 0. Decisions

| Decision | Choice | Why |
|---|---|---|
| Market | Food delivery (Nigeria) | Clear relationships; Faker has an `en_NG` locale for names, phones and addresses |
| Framework | **NestJS** (TypeScript) | Modules, pipes, guards, interceptors and filters map directly onto the requirements |
| ORM / DB | Prisma + managed Postgres | Typed queries, migrations, built-in cursor support, `@default(uuid())` |
| Validation | `class-validator` + `class-transformer` via global `ValidationPipe` | Rules live on DTO classes, one place for query and body |
| IDs | UUID v4 | Not enumerable |
| Money | **Integer kobo** (`priceKobo`, `totalKobo`), currency `NGN` | ₦3,500.00 = `350000`. No floats. Clients divide by 100 for display |
| Pagination | **Cursor (keyset) on every list endpoint**; `offset` supported as an alternative | Excellent band; tradeoff documented |
| Rate limiting | `@nestjs/throttler`, values from config | Per-IP, 429 + `Retry-After` |
| API host | Railway (API service + Postgres) | Managed Postgres, env var UI, public domain |
| Consumer | **Separate application** (own folder/repo, own deployment) on Vercel or Netlify | Proves the API works from outside its own codebase |

## 1. Resource design (≈1 hr) — put in README first

Five resources: **restaurants, menu_items, customers, orders, order_items**

```
customers 1──* orders *──1 restaurants 1──* menu_items
                orders 1──* order_items *──1 menu_items
```

| Resource | Field | Type | Required |
|---|---|---|---|
| restaurant | id | uuid | auto |
| | name | string | yes |
| | cuisine | enum: pizza, burgers, jollof, suya, sushi, chinese, bakery, vegetarian | yes |
| | city | string (Lagos, Abuja, Port Harcourt, Ibadan, Kano…) | yes |
| | address | string | yes |
| | phone | string | no |
| | rating | decimal 0.0–5.0 | no |
| | isOpen | boolean (default true) | yes |
| | createdAt | ISO timestamp | auto |
| menu_item | id | uuid | auto |
| | restaurantId | uuid → restaurant | yes |
| | name | string | yes |
| | description | string | no |
| | category | enum: starter, main, side, drink, dessert | yes |
| | priceKobo | integer ≥ 0 | yes |
| | available | boolean (default true) | yes |
| | createdAt | ISO timestamp | auto |
| customer | id | uuid | auto |
| | name | string | yes |
| | email | string, unique | yes |
| | phone | string | no |
| | city | string | yes |
| | createdAt | ISO timestamp | auto |
| order | id | uuid | auto |
| | customerId | uuid → customer | yes |
| | restaurantId | uuid → restaurant | yes |
| | status | enum: pending, preparing, out_for_delivery, delivered, cancelled | default pending |
| | deliveryAddress | string | yes |
| | totalKobo | integer (server computed) | auto |
| | createdAt / updatedAt | ISO timestamp | auto |
| order_item | id | uuid | auto |
| | orderId | uuid → order | yes |
| | menuItemId | uuid → menu_item | yes |
| | quantity | integer 1–50 | yes |
| | unitPriceKobo | integer (snapshot at order time) | auto |

Volume: 300 restaurants, ~3,000 menu items, 400 customers, 1,000 orders, ~3,000 order items.

Rules:
- Order creation body: `{ customerId, restaurantId, deliveryAddress, items: [{ menuItemId, quantity }] }`. Server checks every item belongs to that restaurant and is available, snapshots `unitPriceKobo`, and computes `totalKobo`. Clients never send totals.
- Indexes: `menu_items(restaurantId)`, `orders(customerId)`, `orders(restaurantId)`, `order_items(orderId)`, plus columns used for filtering and sorting.

## 2. Scaffold (≈1.5 hr)

```
api/
  prisma/
    schema.prisma
    seed.ts                      # idempotent
  src/
    main.ts                      # prefix, trust proxy, pipes, filters, helmet, CORS
    app.module.ts
    config/
      configuration.ts           # pagination + rate-limit + cors + db, read from env with defaults
      validation.ts              # fail fast if env invalid
    common/
      dto/pagination-query.dto.ts
      dto/api-response.ts        # envelope types
      interceptors/response-envelope.interceptor.ts
      filters/all-exceptions.filter.ts
      pipes/parse-uuid.pipe.ts
      utils/cursor.ts            # encode/decode opaque cursor
      utils/paginate.ts          # shared keyset helper
    prisma/prisma.service.ts
    restaurants/  (module, controller, service, dto/)
    menu-items/
    customers/
    orders/
    health/
  test/                          # e2e (supertest) for the ugly-input table
  .env.example
consumer/                        # separate app (see §9)
README.md
```

Setup:
1. `nest new api`, then add `@nestjs/config @nestjs/throttler @prisma/client class-validator class-transformer helmet`; dev: `prisma @faker-js/faker uuid ts-node`.
2. `main.ts`: `app.setGlobalPrefix('api/v1')` (health at `/health`, excluded), `app.set('trust proxy', 1)` on the underlying Express instance, `helmet()`, `enableCors({ origin: config.cors.origins })`, global `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, errorHttpStatusCode: 422 })`, global exception filter, global response interceptor.
3. Versioned from the first commit: global prefix `api/v1` (or Nest URI versioning with `defaultVersion: '1'`, which yields the same path).

## 3. Seed script (≈1.5 hr)

`prisma/seed.ts`, run via `npx prisma db seed`:
- `faker.seed(42)` with `en_NG` locale so output is deterministic.
- Deterministic UUIDs using UUID v5 (fixed namespace + keys like `restaurant:17`), then `upsert` / `createMany({ skipDuplicates: true })`. Running twice yields identical row counts.
- Insert in dependency order: customers, restaurants, menu items, orders, order items. Order totals are computed from their items.
- Prices generated as kobo integers (e.g. ₦800–₦15,000, rounded to the nearest ₦50 → multiples of 5000 kobo).
- Prints per-table counts at the end.
- Verify by running twice and comparing counts. Commit the script, never a dump.

## 4. Response bodies (the contract)

Every response, with no exceptions, uses one of three shapes. Built once, in the interceptor and exception filter, never hand-rolled in controllers.

**Single resource** (`GET /restaurants/:id`) → 200
```json
{
  "data": {
    "id": "3f6c1a52-8b1e-4d0e-9b57-0c5a8e2f7a11",
    "name": "Mama Put Kitchen",
    "cuisine": "jollof",
    "city": "Lagos",
    "address": "14 Adeola Odeku St, Victoria Island",
    "phone": "+2348031234567",
    "rating": 4.6,
    "isOpen": true,
    "createdAt": "2026-01-14T09:21:07.000Z"
  }
}
```

**Collection** (`GET /restaurants?limit=2&cuisine=jollof&sort=rating&order=desc`) → 200
```json
{
  "data": [
    { "id": "…", "name": "Mama Put Kitchen", "cuisine": "jollof", "rating": 4.6 },
    { "id": "…", "name": "Iya Basira Spot", "cuisine": "jollof", "rating": 4.5 }
  ],
  "meta": {
    "total": 41,
    "limit": 2,
    "hasMore": true,
    "nextCursor": "eyJpZCI6IjNmNmMx…",
    "prevCursor": null,
    "offset": null
  }
}
```
`meta` always carries the same keys: `total`, `limit`, `hasMore`, `nextCursor` (null on the last page), `prevCursor` (null on the first page), `offset` (null in cursor mode, a number in offset mode).

**Order with nested items** (`GET /orders/:id`) → 200
```json
{
  "data": {
    "id": "9a2d…",
    "customerId": "…",
    "restaurantId": "…",
    "status": "pending",
    "deliveryAddress": "7 Allen Avenue, Ikeja",
    "currency": "NGN",
    "totalKobo": 1450000,
    "items": [
      { "id": "…", "menuItemId": "…", "name": "Jollof Rice & Chicken", "quantity": 2, "unitPriceKobo": 450000 },
      { "id": "…", "menuItemId": "…", "name": "Chapman", "quantity": 1, "unitPriceKobo": 550000 }
    ],
    "createdAt": "2026-10-23T10:00:00.000Z",
    "updatedAt": "2026-10-23T10:00:00.000Z"
  }
}
```

**Create** (`POST /orders`) → 201 with `Location: /api/v1/orders/<id>` header and the same body as the item above.

**Delete** (`DELETE /orders/:id`) → 204, no body.

**Errors**: always `{ "error": { "code", "message", "details"? } }` with the real HTTP status.

| Status | `code` | Example |
|---|---|---|
| 400 | `BAD_REQUEST` | `{"error":{"code":"BAD_REQUEST","message":"offset must be 0 or greater","details":[{"field":"offset","message":"must not be less than 0"}]}}` |
| 400 | `INVALID_SORT_FIELD` | `{"error":{"code":"INVALID_SORT_FIELD","message":"Cannot sort by 'banana'. Allowed: name, rating, createdAt"}}` |
| 400 | `INVALID_CURSOR` | `{"error":{"code":"INVALID_CURSOR","message":"Cursor is malformed or does not match the current sort"}}` |
| 404 | `NOT_FOUND` | `{"error":{"code":"NOT_FOUND","message":"Restaurant not found"}}` |
| 409 | `INVALID_STATUS_TRANSITION` | `{"error":{"code":"INVALID_STATUS_TRANSITION","message":"Cannot change order from 'delivered' to 'pending'"}}` |
| 422 | `VALIDATION_ERROR` | `{"error":{"code":"VALIDATION_ERROR","message":"Request body is invalid","details":[{"field":"customerId","message":"customerId is required"}]}}` |
| 429 | `RATE_LIMITED` | `{"error":{"code":"RATE_LIMITED","message":"Too many requests. Retry in 37 seconds.","details":{"retryAfterSeconds":37}}}` plus `Retry-After: 37` |
| 500 | `INTERNAL` | `{"error":{"code":"INTERNAL","message":"Something went wrong"}}` (stack trace only in logs) |

Implementation:
- `ResponseEnvelopeInterceptor`: if the handler returns `{ items, meta }` → `{ data: items, meta }`; any other value → `{ data: value }`; `undefined` (204) passes through.
- `AllExceptionsFilter` (`@Catch()`): maps `HttpException`, `ValidationPipe` errors (flatten to `details`), Prisma errors (`P2025` → 404, `P2002` → 409, `P2003` → 422), `ThrottlerException` → 429, and unknown errors → 500. Unknown routes also pass through it, so 404s use the same shape.

## 5. Endpoints (≈3.5 hr)

Base: `/api/v1`

| Method | Path | Filters | Sort fields |
|---|---|---|---|
| GET | `/restaurants` | `cuisine`, `city`, `minRating`, `isOpen`, `q` (name contains) | `name`, `rating`, `createdAt` |
| GET | `/restaurants/:id` | | |
| GET | `/restaurants/:id/menu` | `category`, `minPrice`, `maxPrice` (kobo), `available` | `priceKobo` (alias `price`), `name`, `createdAt` |
| GET | `/menu-items` | `restaurantId`, `category`, `minPrice`, `maxPrice`, `available` | same |
| GET | `/menu-items/:id` | | |
| GET | `/customers` | `city`, `q` | `name`, `createdAt` |
| GET | `/customers/:id` | | |
| GET | `/customers/:id/orders` | `status` | `createdAt`, `totalKobo` |
| GET | `/orders` | `status`, `restaurantId`, `customerId`, `minTotal`, `maxTotal` (kobo), `from`, `to` (ISO dates) | `createdAt`, `totalKobo` |
| POST | `/orders` | | |
| GET | `/orders/:id` | | |
| PATCH | `/orders/:id` | body: `status`, `deliveryAddress` only | |
| DELETE | `/orders/:id` | | |
| GET | `/health` (outside `/v1`) | | |

Status transitions allowed: pending → preparing → out_for_delivery → delivered; pending or preparing → cancelled. Anything else returns 409.

### Cursor pagination (on every list endpoint)

Query params shared by all lists (`PaginationQueryDto`):
- `limit` integer, default 20, max 100. **Values above 100 are clamped to 100**; below 1 or non-numeric → 400. If omitted, 20 is used and never the whole table.
- `cursor` opaque string from a previous `meta.nextCursor` / `prevCursor`.
- `offset` integer ≥ 0, optional alternative to `cursor`. Sending both returns 400.
- `sort` (whitelist per resource, default `createdAt`), `order` = `asc` | `desc` (default `desc`).

How it works (shared helper `paginate()`):
1. Always order by `[sortField order, id order]`. `id` is the unique tiebreaker, so ordering is total and stable.
2. Cursor = base64url JSON `{ id, sort, order, v }` where `v` is the last row's sort value. Decoding validates that `sort` and `order` match the current request; otherwise `INVALID_CURSOR`.
3. Prisma: `findMany({ take: limit + 1, cursor: { id }, skip: 1, orderBy, where })`. Fetch one extra row to determine `hasMore` without a second query, then drop it.
4. `total` from `count({ where })` using the same filters.
5. `prevCursor`: cursor for walking backward (query with the reversed order and `take: limit`, then reverse the rows), or null on the first page.
6. Offset mode: `skip: offset, take: limit`; `nextCursor` is still returned so a client can switch to cursor mode.

Pagination parameters go through one DTO so rules aren't repeated in controllers.

## 6. Ugly-input tests (≈1.5 hr) — supertest e2e + a `scripts/smoke.sh` for the live URL

| Request | Expected |
|---|---|
| `GET /restaurants?limit=5000` | 200, `meta.limit == 100`, 100 rows |
| `?limit=0`, `?limit=abc` | 400 |
| `?offset=-1` | 400, message names `offset` |
| `?cursor=garbage` | 400 `INVALID_CURSOR` |
| `?cursor=…&offset=10` | 400 |
| `?sort=banana` | 400 `INVALID_SORT_FIELD`, allowed fields listed |
| `?order=sideways` | 400 |
| `?minRating=abc` | 400 |
| `?unknown=1` | 400 (unknown query params rejected) |
| `/restaurants/not-a-uuid` | 404 `NOT_FOUND` (never 500) |
| `/restaurants/<valid but unknown uuid>` | 404 |
| `POST /orders` missing `customerId` | 422, `details[0].field == "customerId"` |
| `POST /orders` with `quantity: 0` | 422 |
| `POST /orders` with item from another restaurant | 422 |
| `POST /orders` unknown `customerId` | 422 (or 404, pick one and document) |
| `POST /orders` malformed JSON | 400 |
| `PATCH /orders/:id` with `totalKobo` in body | 422 (forbidden property) |
| `PATCH` delivered → pending | 409 |
| `DELETE /orders/:id` twice | 204 then 404 |
| Walk every page via `nextCursor` | no duplicates, no gaps, total rows == `meta.total` |
| Unknown route | 404 in error envelope |
| 101st request within a minute | 429 + `Retry-After` |

## 7. Rate limiting (set) (≈0.5 hr)

- `config/configuration.ts` holds every number, each overridable by env:
  ```ts
  rateLimit: { ttlMs: int(env.RATE_LIMIT_TTL_MS, 60_000), limit: int(env.RATE_LIMIT_MAX, 100) },
  pagination: { defaultLimit: int(env.PAGINATION_DEFAULT_LIMIT, 20), maxLimit: int(env.PAGINATION_MAX_LIMIT, 100) },
  ```
- `ThrottlerModule.forRootAsync` reads from `ConfigService`; `ThrottlerGuard` registered globally via `APP_GUARD`. Handlers contain no numbers.
- Keyed on client IP. `trust proxy` set in `main.ts` so Railway's `X-Forwarded-For` is used; without it all users share one bucket.
- Exception filter converts `ThrottlerException` into the 429 envelope above and sets `Retry-After` (seconds). `/health` uses `@SkipThrottle()`.
- Evidence command: `for i in $(seq 1 120); do curl -s -o /dev/null -w "%{http_code}\n" $URL/api/v1/restaurants; done | sort | uniq -c`, then a `curl -i` showing the 429 and headers.

## 8. README documentation (≈2 hr)

Order:
1. Overview + **live URL**
2. Resource design (tables and relationship diagram from §1)
3. Conventions: base URL, versioning, money in kobo (with a worked example), envelope, error shape, status code table, pagination, filtering, sorting, rate limit headers
4. Endpoint reference, **for each endpoint**: method, path, query parameter table (name / type / default / allowed values), curl command, real example response pasted from the live API
5. Running locally: env vars, `prisma migrate deploy`, `prisma db seed`
6. **Design decisions**:
   - Why these resources
   - Why UUIDs (sequential integers allow enumerating the dataset)
   - Why cursor pagination, and the tradeoff: offset is simple and supports jumping to page N, but it scans and discards `offset` rows (slow on deep pages) and shifts under inserts and deletes so users see duplicates or miss rows; cursor is fast and stable, but has no random page access and needs an opaque token. Offset is kept as an option for small jumps.
   - Why kobo integers (no floating point rounding; matches how Nigerian payment providers represent amounts)
   - Envelope shape and why (`data` and `meta` always present, errors never returned with 200, one shape lets clients write one parser)
   - Rate limit choice
7. Deployment notes

Test: someone who has never seen the project can use the API from this README alone.

## 9. Deploy the API (≈1.5 hr)

1. Push to GitHub (no `.env`, no dumps).
2. Railway: new project → add Postgres → add service from repo (root `api/`).
3. Env vars: `DATABASE_URL` (reference Postgres), `NODE_ENV=production`, `PORT` (Railway injects), `RATE_LIMIT_TTL_MS`, `RATE_LIMIT_MAX`, `PAGINATION_DEFAULT_LIMIT`, `PAGINATION_MAX_LIMIT`, `CORS_ORIGINS` (consumer URL, comma separated).
4. Build: `npm run build` (includes `prisma generate`). Release/start: `npx prisma migrate deploy && node dist/main`.
5. **Run the seed against production**: from your machine with the production `DATABASE_URL` (Railway public connection string) or `railway run npx prisma db seed`. Run twice and confirm counts don't change.
6. Generate a public domain; check `/health`.
7. Verify from a phone on mobile data (wifi off) or another person's computer. Confirm `GET /api/v1/restaurants` returns `meta.total` around 300.

## 10. Consumer (separate application, deployed separately) (≈2 hr)

Own folder `consumer/` (ideally its own repo) with its own build and its own deployment on Vercel or Netlify. It shares no code with the API and reads only a single env/config value: `API_BASE_URL=https://<api-domain>/api/v1` (a Vite app with `VITE_API_BASE_URL`, or plain HTML/JS with a `config.js`). No localhost fallback in the deployed build.

Features:
- Restaurant list showing name, cuisine, city, rating
- Filter controls: cuisine, city, min rating, sort and order
- "Next page" and "Previous page" using `meta.nextCursor` / `prevCursor`; text like "Showing 20 of 300"; pagination resets when filters change
- Click a restaurant → shows its menu from `/restaurants/:id/menu`, prices converted from kobo to `₦3,500.00` with `Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN' })` (divide by 100)
- States: **loading**, **empty** ("No restaurants match your filters"), **error** (network failure or error envelope shows `error.message` with a Retry button; a 429 shows "Slow down, try again in N seconds" using `Retry-After`)
- Add the consumer's deployed origin to the API's `CORS_ORIGINS` and redeploy the API

## 11. Evidence (≈0.5 hr) → `/evidence`

1. Live API URL (top of README)
2. Terminal screenshot: `curl -i "$URL/api/v1/restaurants?limit=5&cuisine=jollof&sort=rating&order=desc"` showing the paginated envelope with `nextCursor`
3. Screenshot of the 429 response with `Retry-After` visible
4. Screenshot of the deployed consumer showing live data (plus empty and error states as bonus)
5. The committed seed script (`api/prisma/seed.ts`)
6. Optional: e2e test run showing the ugly-input table passing

## 12. Timeline

| Block | Hours | Cumulative |
|---|---|---|
| Design + README tables | 1 | 1 |
| Scaffold, Prisma schema, config | 1.5 | 2.5 |
| Seed script | 1.5 | 4 |
| Envelope, filter, pagination helper | 1.5 | 5.5 |
| Read endpoints (all resources) | 2 | 7.5 |
| Order write endpoints | 1.5 | 9 |
| Validation, error mapping, e2e tests | 1.5 | 10.5 |
| Rate limiting | 0.5 | 11 |
| Deploy API + seed prod | 1.5 | 12.5 |
| Consumer build + deploy | 2 | 14.5 |
| README polish + evidence | 1 | 15.5 |
| Buffer | 0.5 | 16 |

If time runs short: cut `/customers/:id/orders` and the date filters first. Never cut tests for pagination or the consumer's error and empty states.

## 13. Final checklist

- [ ] NestJS app, global prefix `api/v1`
- [ ] All IDs UUID; no integers exposed
- [ ] Money fields end in `Kobo` and are integers; README explains
- [ ] Every list endpoint supports `limit`, `cursor`, `offset`, filters (≥2), `sort`, `order`
- [ ] Omitting `limit` returns 20 rows; 5000 is clamped to 100
- [ ] All responses (success, 404 on unknown routes, 429, 500) use the documented envelopes; no 200 with an error body
- [ ] Rate limit and pagination numbers live only in `configuration.ts` / env
- [ ] `trust proxy` set; 429 carries `Retry-After`
- [ ] Seed is deterministic and idempotent; run on production; counts verified
- [ ] README curl examples were run and responses pasted from the live API
- [ ] Cursor vs offset tradeoff explained under "Design decisions"
- [ ] Consumer is a separate deployed app calling the public URL; loading, empty and error states work
- [ ] CORS allows the consumer origin
- [ ] `.env` and DB dumps not committed
- [ ] Evidence screenshots saved
