# Food Delivery API

A public, read-friendly REST API for a Nigerian food-delivery market: restaurants, their menus, customers and the orders customers place. Prices are in **kobo**. Everything is versioned under `/api/v1`.

- **Live API:** `https://food-delivery-api-4a2m.onrender.com` *(hosted on Render; see [Deployment](#deployment))*
- **Consumer app:** `https://YOUR-CONSUMER.vercel.app` *(a separate application that calls the live API; source in [`consumer/`](consumer/))*
- **Stack:** NestJS 12, Prisma 7, PostgreSQL, `class-validator`, `@nestjs/throttler`

Quick taste:

```bash
API=https://food-delivery-api-4a2m.onrender.com
curl "$API/api/v1/restaurants?cuisine=jollof&sort=rating&order=desc&limit=2"
```

## Contents

1. [Resource design](#resource-design)
2. [Conventions](#conventions) (envelope, errors, pagination, filtering, sorting, money, rate limits)
3. [Endpoint reference](#endpoint-reference)
4. [Running locally](#running-locally)
5. [Testing](#testing)
6. [Deployment](#deployment)
7. [Design decisions](#design-decisions)

---

## Resource design

Five resources. Every id is a UUID.

```
customers 1──* orders *──1 restaurants 1──* menu_items
                 orders 1──* order_items *──1 menu_items
```

| Resource | Field | Type | Required | Notes |
|---|---|---|---|---|
| **restaurant** | `id` | uuid | auto | |
| | `name` | string | yes | |
| | `cuisine` | enum | yes | `pizza` `burgers` `jollof` `suya` `sushi` `chinese` `bakery` `vegetarian` |
| | `city` | string | yes | |
| | `address` | string | yes | |
| | `phone` | string \| null | no | |
| | `rating` | number 0–5 | yes (default 0) | one decimal place |
| | `isOpen` | boolean | yes (default true) | closed restaurants cannot receive orders |
| | `createdAt` | ISO 8601 | auto | |
| **menu_item** | `id` | uuid | auto | |
| | `restaurantId` | uuid → restaurant | yes | |
| | `name` | string | yes | |
| | `description` | string \| null | no | |
| | `category` | enum | yes | `starter` `main` `side` `drink` `dessert` |
| | `priceKobo` | integer ≥ 0 | yes | 1 naira = 100 kobo |
| | `available` | boolean | yes (default true) | |
| | `createdAt` | ISO 8601 | auto | |
| **customer** | `id` | uuid | auto | |
| | `name` | string | yes | |
| | `email` | string, unique | yes | seeded with `@example.com` addresses |
| | `phone` | string \| null | no | |
| | `city` | string | yes | |
| | `createdAt` | ISO 8601 | auto | |
| **order** | `id` | uuid | auto | |
| | `customerId` | uuid → customer | yes | |
| | `restaurantId` | uuid → restaurant | yes | |
| | `status` | enum | default `pending` | `pending` `preparing` `out_for_delivery` `delivered` `cancelled` |
| | `deliveryAddress` | string ≤ 250 | yes | |
| | `currency` | `"NGN"` | auto | constant |
| | `totalKobo` | integer | auto | computed by the server from the lines |
| | `createdAt`, `updatedAt` | ISO 8601 | auto | |
| **order_item** (a line inside an order) | `id` | uuid | auto | |
| | `menuItemId` | uuid → menu_item | yes | |
| | `name` | string | auto | menu item name, for display |
| | `quantity` | integer 1–50 | yes | |
| | `unitPriceKobo` | integer | auto | price **at the time of ordering** |

Relationships: a restaurant has many menu items; a customer places many orders; an order belongs to one customer and one restaurant and has many lines; each line points at one menu item of that restaurant.

Seeded volume: 300 restaurants, ~3,270 menu items, 400 customers, 1,000 orders, ~3,040 order lines.

---

## Conventions

### Base URL and versioning

All endpoints live under `/api/v1`. A future breaking change ships as `/api/v2` and `/v1` keeps working. `GET /health` (unversioned) is for uptime checks.

### Success envelope

Single resource: `{ "data": { ... } }`

Collection: `{ "data": [ ... ], "meta": { ... } }`

`meta` always has the same keys:

| Key | Type | Meaning |
|---|---|---|
| `total` | integer | rows matching the filters (ignores pagination) |
| `limit` | integer | page size actually used (after clamping) |
| `hasMore` | boolean | another page exists after this one |
| `nextCursor` | string \| null | pass as `?cursor=` to get the next page; `null` on the last page |
| `prevCursor` | string \| null | pass as `?cursor=` to go back; `null` on the first page |
| `offset` | integer \| null | the offset used in offset mode; `null` in cursor mode |

`DELETE` returns `204 No Content` with an empty body. `POST` returns `201` plus a `Location` header.

### Error envelope

Every error, from every endpoint, including unknown routes and rate limiting, has this shape and an honest HTTP status. A response with a 2xx status never contains an error.

```json
{ "error": { "code": "NOT_FOUND", "message": "Restaurant not found" } }
```

`details` is added when there is more to say (which field failed, how long to wait).

| Status | `code` | When |
|---|---|---|
| 400 | `BAD_REQUEST` | bad query parameter (negative offset, non-numeric limit, unknown filter, malformed JSON, …) |
| 400 | `INVALID_SORT_FIELD` | `sort` is not one of the allowed fields (the message lists them) |
| 400 | `INVALID_CURSOR` | cursor is garbage, or was issued for a different `sort`/`order` |
| 404 | `NOT_FOUND` | unknown id, **malformed id**, or unknown route |
| 409 | `INVALID_STATUS_TRANSITION` | order status change not allowed |
| 409 | `CONFLICT` | e.g. editing the address of an order that already left the kitchen |
| 422 | `VALIDATION_ERROR` | request body invalid; `details` names each field |
| 429 | `RATE_LIMITED` | too many requests; see `Retry-After` |
| 500 | `INTERNAL` | unexpected; message is generic, details are only in server logs |

### Pagination (cursor first, offset optional)

Every list endpoint accepts:

| Param | Type | Default | Notes |
|---|---|---|---|
| `limit` | integer ≥ 1 | `20` | **values above `100` are clamped to `100`**, never honoured. `0`, negatives and non-numbers are `400`. |
| `cursor` | string | none | opaque token from `meta.nextCursor` / `meta.prevCursor`. |
| `offset` | integer ≥ 0 | none | alternative to `cursor`. Sending both is `400`. Negative is `400`. |
| `sort` | string | `createdAt` | allowed fields differ per endpoint. Unknown field is `400`. |
| `order` | `asc` \| `desc` | `desc` | case-insensitive. |

Without a `limit` you get 20 rows, never the whole table. The limits live in configuration (`PAGINATION_DEFAULT_LIMIT`, `PAGINATION_MAX_LIMIT`).

**Walking pages with a cursor** (recommended):

```bash
# page 1
curl "$API/api/v1/restaurants?limit=20&sort=name&order=asc"
# copy meta.nextCursor, then keep sort/order identical:
curl "$API/api/v1/restaurants?limit=20&sort=name&order=asc&cursor=<nextCursor>"
# stop when meta.hasMore is false
```

Cursors are tied to the `sort` and `order` they were issued for. Keep those parameters unchanged while paging; changing filters or sort means starting again from the first page.

**Offset mode** is available when you want to jump straight to a page: `?limit=20&offset=40`.

### Filtering and sorting

Each list endpoint documents its filters below. Filters combine with AND. Unknown query parameters are rejected with `400` so typos don't silently return unfiltered data. Text filters (`city`, `q`) are case-insensitive; `q` matches a substring, and `%`/`_` are treated as ordinary characters.

### Money

All amounts are **integer kobo** (`priceKobo`, `totalKobo`, `unitPriceKobo`, `minPrice`, `maxPrice`, `minTotal`, `maxTotal`). `1800000` kobo = ₦18,000.00. Divide by 100 to display naira. Using integers avoids floating-point rounding errors.

### Rate limiting

Per client IP, **100 requests per 60 seconds** by default (`RATE_LIMIT_MAX`, `RATE_LIMIT_TTL_MS`). Responses from rate-limited routes carry `X-RateLimit-Limit`, `X-RateLimit-Remaining` and `X-RateLimit-Reset` (seconds). Past the limit you get `429` with a `Retry-After` header (seconds):

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 37
```
```json
{ "error": { "code": "RATE_LIMITED", "message": "Too many requests. Retry in 37 seconds.", "details": { "retryAfterSeconds": 37 } } }
```

`/health` is exempt.

### CORS

Browsers on origins listed in `CORS_ORIGINS` can call the API; `Retry-After`, `Location` and the `X-RateLimit-*` headers are exposed to them.

---

## Endpoint reference

Examples assume `API=https://food-delivery-api-4a2m.onrender.com`. Responses are real output from the seeded database, with long lists trimmed to two rows. Replace the ids with ones from your own calls.

### Restaurants

#### `GET /api/v1/restaurants`: list restaurants

| Query param | Type | Default | Description |
|---|---|---|---|
| `cuisine` | enum | none | `pizza` `burgers` `jollof` `suya` `sushi` `chinese` `bakery` `vegetarian` |
| `city` | string | none | exact city, case-insensitive (`Lagos`, `Abuja`, `Port Harcourt`, `Ibadan`, `Kano`, `Enugu`, `Benin City`, `Kaduna`) |
| `minRating` | number 0–5 | none | rating ≥ value |
| `isOpen` | `true` \| `false` | none | |
| `q` | string ≤ 100 | none | name contains (case-insensitive) |
| `limit`, `cursor`, `offset`, `order` | | see [Pagination](#pagination-cursor-first-offset-optional) | |
| `sort` | `name` \| `rating` \| `createdAt` | `createdAt` | |

```bash
curl "$API/api/v1/restaurants?limit=2&cuisine=jollof&sort=rating&order=desc"
```
```json
{
  "data": [
    {
      "id": "c26f62f4-7e3f-5336-ab4c-d200d0b86bea",
      "name": "Funmilayo's Buka",
      "cuisine": "jollof",
      "city": "Benin City",
      "address": "14061 Oladeji Loaf",
      "phone": "+2348098308981",
      "rating": 5,
      "isOpen": true,
      "createdAt": "2026-07-17T16:59:26.120Z"
    },
    {
      "id": "bb8b3149-6b91-50eb-acc5-b135d4b285d9",
      "name": "Adegoke's Buka",
      "cuisine": "jollof",
      "city": "Kano",
      "address": "252 Augustina Garden",
      "phone": "+2347039311508",
      "rating": 4.9,
      "isOpen": true,
      "createdAt": "2026-05-03T21:01:27.119Z"
    }
  ],
  "meta": {
    "total": 48,
    "limit": 2,
    "hasMore": true,
    "nextCursor": "eyJkIjoibmV4dCIsImkiOiJiYjhiMzE0OS02YjkxLTUwZWItYWNjNS1iMTM1ZDRiMjg1ZDkiLCJ2Ijo0LjksInMiOiJyYXRpbmciLCJvIjoiZGVzYyJ9",
    "prevCursor": null,
    "offset": null
  }
}
```

#### `GET /api/v1/restaurants/:id`: one restaurant

```bash
curl "$API/api/v1/restaurants/29018020-db8b-556d-a948-bb9ebbe693dd"
```
```json
{
  "data": {
    "id": "29018020-db8b-556d-a948-bb9ebbe693dd",
    "name": "Olubukola's Noodle Bar",
    "cuisine": "chinese",
    "city": "Enugu",
    "address": "854 Yaqub Dam",
    "phone": "+2348038241313",
    "rating": 3.4,
    "isOpen": true,
    "createdAt": "2026-09-29T14:00:53.885Z"
  }
}
```
Unknown or malformed id → `404 NOT_FOUND`.

#### `GET /api/v1/restaurants/:id/menu`: a restaurant's menu (nested)

| Query param | Type | Default | Description |
|---|---|---|---|
| `category` | enum | none | `starter` `main` `side` `drink` `dessert` |
| `minPrice`, `maxPrice` | integer kobo ≥ 0 | none | inclusive range; `minPrice > maxPrice` is `400` |
| `available` | `true` \| `false` | none | |
| `limit`, `cursor`, `offset`, `order` | | see Pagination | |
| `sort` | `name` \| `price` \| `createdAt` | `createdAt` | `price` sorts by `priceKobo` |

```bash
curl "$API/api/v1/restaurants/29018020-db8b-556d-a948-bb9ebbe693dd/menu?available=true&sort=price&order=asc&limit=2"
```
```json
{
  "data": [
    {
      "id": "315e2014-d31f-5576-ac1c-728c26f07d4c",
      "restaurantId": "29018020-db8b-556d-a948-bb9ebbe693dd",
      "name": "Fried Banana",
      "description": "Fried Banana. Made with locally sourced ingredients.",
      "category": "dessert",
      "priceKobo": 180000,
      "available": true,
      "createdAt": "2026-09-29T14:00:53.885Z"
    },
    {
      "id": "1632cb68-7ce9-57e8-ba5b-6bc824c59304",
      "restaurantId": "29018020-db8b-556d-a948-bb9ebbe693dd",
      "name": "Fried Noodles",
      "description": "Fried Noodles. Generous portion, served hot.",
      "category": "main",
      "priceKobo": 190000,
      "available": true,
      "createdAt": "2026-09-29T14:00:53.885Z"
    }
  ],
  "meta": { "total": 7, "limit": 2, "hasMore": true, "nextCursor": "eyJk…", "prevCursor": null, "offset": null }
}
```

### Menu items

#### `GET /api/v1/menu-items`: list all menu items

Same query parameters as the nested menu, plus `restaurantId` (uuid). `GET /api/v1/menu-items/:id` returns one item (same shape as above, wrapped in `{ "data": … }`).

```bash
curl "$API/api/v1/menu-items?category=drink&maxPrice=100000&sort=price&order=asc&limit=5"
curl "$API/api/v1/menu-items/315e2014-d31f-5576-ac1c-728c26f07d4c"
```

### Customers

#### `GET /api/v1/customers`: list customers

| Query param | Type | Default | Description |
|---|---|---|---|
| `city` | string | none | case-insensitive exact match |
| `q` | string ≤ 100 | none | name contains (case-insensitive) |
| `sort` | `name` \| `createdAt` | `createdAt` | |
| `limit`, `cursor`, `offset`, `order` | | see Pagination | |

```bash
curl "$API/api/v1/customers?city=Lagos&limit=2&sort=name&order=asc"
```
```json
{
  "data": [
    {
      "id": "e907650b-a2c6-5dc0-a8c7-4159f7de97c2",
      "name": "Abisoye Katherine",
      "email": "abisoye.katherine.343@example.com",
      "phone": "+2348092127450",
      "city": "Lagos",
      "createdAt": "2026-05-02T17:02:56.409Z"
    },
    {
      "id": "b29606b0-50cc-5398-be8e-ae15a4740d0a",
      "name": "Aderinsola Toluwani",
      "email": "aderinsola.toluwani.349@example.com",
      "phone": "+2348030548285",
      "city": "Lagos",
      "createdAt": "2026-09-23T07:31:49.492Z"
    }
  ],
  "meta": { "total": 51, "limit": 2, "hasMore": true, "nextCursor": "eyJk…", "prevCursor": null, "offset": null }
}
```

`GET /api/v1/customers/:id` returns one customer (`404` if unknown or malformed).

#### `GET /api/v1/customers/:id/orders`: a customer's orders (nested)

Query: `status` (enum, see orders), `sort` = `createdAt` \| `total` (default `createdAt`), plus the pagination params. Items are the same objects as in `GET /api/v1/orders`.

```bash
curl "$API/api/v1/customers/d96e8754-af25-50fb-b702-78386a86d72e/orders?status=delivered&limit=5"
```

### Orders

#### `GET /api/v1/orders`: list orders

| Query param | Type | Default | Description |
|---|---|---|---|
| `status` | enum | none | `pending` `preparing` `out_for_delivery` `delivered` `cancelled` |
| `restaurantId` | uuid | none | |
| `customerId` | uuid | none | |
| `minTotal`, `maxTotal` | integer kobo ≥ 0 | none | inclusive range on `totalKobo` |
| `from`, `to` | ISO 8601 | none | created-at range. `to=2026-03-31` includes that whole day. `from` after `to` is `400`. |
| `sort` | `createdAt` \| `total` | `createdAt` | `total` sorts by `totalKobo` |
| `limit`, `cursor`, `offset`, `order` | | see Pagination | |

List items do not include `items`; fetch `GET /api/v1/orders/:id` for the lines.

```bash
curl "$API/api/v1/orders?status=delivered&sort=total&order=desc&limit=2"
```
```json
{
  "data": [
    {
      "id": "c46f96f0-be94-5738-976e-8c1c98525d59",
      "customerId": "2e9e806a-4084-5cea-9167-d8b82806ecc4",
      "restaurantId": "8b6abd22-23a8-51a8-98c2-f2663d3d8950",
      "status": "delivered",
      "deliveryAddress": "70914 Osuagwu Walk",
      "currency": "NGN",
      "totalKobo": 19045000,
      "createdAt": "2026-08-28T09:05:38.701Z",
      "updatedAt": "2026-08-28T09:05:38.701Z"
    },
    {
      "id": "624e5b2e-55f4-55a6-be95-f27df242607b",
      "customerId": "4ba5053d-e20e-5cb6-9e5a-5332bc4c24ef",
      "restaurantId": "ed905e5d-f7d7-547f-893c-8f75f803c777",
      "status": "delivered",
      "deliveryAddress": "33852 Omawunmi Square",
      "currency": "NGN",
      "totalKobo": 18940000,
      "createdAt": "2026-05-12T20:35:10.140Z",
      "updatedAt": "2026-05-12T20:35:10.140Z"
    }
  ],
  "meta": { "total": 640, "limit": 2, "hasMore": true, "nextCursor": "eyJk…", "prevCursor": null, "offset": null }
}
```

#### `GET /api/v1/orders/:id`: one order, with its lines

```bash
curl "$API/api/v1/orders/4a3ecf3c-5356-4e23-887a-c8b4b4327ac6"
```
```json
{
  "data": {
    "id": "4a3ecf3c-5356-4e23-887a-c8b4b4327ac6",
    "customerId": "d96e8754-af25-50fb-b702-78386a86d72e",
    "restaurantId": "29018020-db8b-556d-a948-bb9ebbe693dd",
    "status": "pending",
    "deliveryAddress": "12 Allen Avenue, Ikeja",
    "currency": "NGN",
    "totalKobo": 3060000,
    "items": [
      { "id": "2dcc702f-fe1a-4681-b051-016a772df3ca", "menuItemId": "b5ad4ee5-ceee-53a3-be72-01fecb9fc402", "name": "Sweet & Sour Chicken", "quantity": 2, "unitPriceKobo": 1420000 },
      { "id": "39ee5ad5-25b2-4108-8252-8cd552a2ab13", "menuItemId": "c3c41102-1c12-5872-9498-a7cf541f338e", "name": "Egg Drop Soup", "quantity": 1, "unitPriceKobo": 220000 }
    ],
    "createdAt": "2026-10-23T21:55:32.900Z",
    "updatedAt": "2026-10-23T21:55:32.900Z"
  }
}
```

#### `POST /api/v1/orders`: place an order

Body (JSON):

| Field | Type | Required | Rules |
|---|---|---|---|
| `customerId` | uuid | yes | must exist |
| `restaurantId` | uuid | yes | must exist and be open |
| `deliveryAddress` | string | yes | non-empty, ≤ 250 characters |
| `items` | array | yes | 1–50 lines, no duplicate `menuItemId` |
| `items[].menuItemId` | uuid | yes | must exist, belong to `restaurantId`, and be `available` |
| `items[].quantity` | integer | yes | 1–50 |

Any other property (`totalKobo`, `status`, `id`, …) is rejected with `422`. The server computes the total and snapshots each line's price.

```bash
curl -i -X POST "$API/api/v1/orders" \
  -H "Content-Type: application/json" \
  -d '{
    "customerId": "d96e8754-af25-50fb-b702-78386a86d72e",
    "restaurantId": "29018020-db8b-556d-a948-bb9ebbe693dd",
    "deliveryAddress": "12 Allen Avenue, Ikeja",
    "items": [
      { "menuItemId": "b5ad4ee5-ceee-53a3-be72-01fecb9fc402", "quantity": 2 },
      { "menuItemId": "c3c41102-1c12-5872-9498-a7cf541f338e", "quantity": 1 }
    ]
  }'
```
Response: `201 Created`, header `Location: /api/v1/orders/4a3ecf3c-5356-4e23-887a-c8b4b4327ac6`, body identical to `GET /api/v1/orders/:id` above (status `pending`).

Missing fields → `422`, with every missing field named:
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request body is invalid",
    "details": [
      { "field": "customerId", "message": "customerId is required" },
      { "field": "deliveryAddress", "message": "deliveryAddress is required" },
      { "field": "items", "message": "items is required" }
    ]
  }
}
```
Referenced rows that don't exist, a closed restaurant, an unavailable item, an item from a different restaurant, or duplicate lines are also `422`, with `details[].field` such as `customerId` or `items.0.menuItemId`.

#### `PATCH /api/v1/orders/:id`: partial update

Only two fields can change:

| Field | Type | Rules |
|---|---|---|
| `status` | enum | allowed moves: `pending → preparing → out_for_delivery → delivered`; `pending` or `preparing → cancelled`. Re-sending the current status is a harmless `200`. |
| `deliveryAddress` | string | only while `pending` or `preparing` |

At least one field is required (`422` otherwise).

```bash
curl -X PATCH "$API/api/v1/orders/4a3ecf3c-5356-4e23-887a-c8b4b4327ac6" \
  -H "Content-Type: application/json" \
  -d '{ "status": "preparing" }'
```
→ `200` with the updated order (including `items`). An illegal move:
```json
{ "error": { "code": "INVALID_STATUS_TRANSITION", "message": "Cannot change order from 'preparing' to 'pending'" } }
```
(`409`). Nothing is changed when any part of the request is rejected.

#### `DELETE /api/v1/orders/:id`: remove an order

```bash
curl -i -X DELETE "$API/api/v1/orders/4a3ecf3c-5356-4e23-887a-c8b4b4327ac6"
```
→ `204 No Content`. Deleting again → `404`. The order's lines are removed with it.

### Health

`GET /health` → `200 { "data": { "status": "ok" } }` (checks the database). Not rate limited.

### Common error examples

```bash
curl -i "$API/api/v1/restaurants?limit=5000"      # 200, meta.limit is 100 (clamped)
curl -i "$API/api/v1/restaurants?offset=-1"       # 400
curl -i "$API/api/v1/restaurants?sort=banana"     # 400 INVALID_SORT_FIELD
curl -i "$API/api/v1/restaurants/not-a-uuid"      # 404 NOT_FOUND
curl -i "$API/api/v1/restaurants?cursor=garbage"  # 400 INVALID_CURSOR
```
```json
{ "error": { "code": "BAD_REQUEST", "message": "offset must be 0 or greater", "details": [ { "field": "offset", "message": "offset must be 0 or greater" } ] } }
```
```json
{ "error": { "code": "INVALID_SORT_FIELD", "message": "Cannot sort by 'banana'. Allowed: name, rating, createdAt", "details": [ { "field": "sort", "message": "must be one of: name, rating, createdAt" } ] } }
```

---

## Running locally

Requirements: Node 20.19+ (22 recommended), PostgreSQL 14+.

```bash
cd api
npm install                      # also runs `prisma generate`
cp .env.example .env             # edit DATABASE_URL
npx prisma migrate deploy        # create tables
npm run db:seed                  # load the dataset (safe to run repeatedly)
npm run start:dev                # http://localhost:3000/api/v1/restaurants
```

### Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | none (required) | Postgres connection string |
| `PORT` | `3000` | HTTP port (Render injects this) |
| `TRUST_PROXY_HOPS` | `1` (`3` on Render) | reverse proxies in front of the app; the client IP is taken that many hops from the right of `X-Forwarded-For`, so rate limits are per real client and cannot be spoofed |
| `RATE_LIMIT_MAX` | `100` | requests allowed per window per IP |
| `RATE_LIMIT_TTL_MS` | `60000` | window length in milliseconds |
| `PAGINATION_DEFAULT_LIMIT` | `20` | page size when `limit` is omitted |
| `PAGINATION_MAX_LIMIT` | `100` | largest page size; bigger requests are clamped |
| `CORS_ORIGINS` | none | comma-separated browser origins allowed to call the API (`*` for any) |
| `TEST_DATABASE_URL` | none | separate database used by the e2e tests |

All of these are read in one place, [`api/src/config/configuration.ts`](api/src/config/configuration.ts), and validated at boot ([`validate-env.ts`](api/src/config/validate-env.ts)). Handlers contain no limits.

### The seed script

[`api/prisma/seed.ts`](api/prisma/seed.ts) uses `@faker-js/faker` with the Nigerian (`en_NG`) locale and a fixed random seed, so it generates the same dataset every time. Row ids are UUID v5 values derived from stable keys, and inserts use `skipDuplicates`, so **running it twice inserts nothing the second time**:

```
customers: 0 inserted, 400 already present
restaurants: 0 inserted, 300 already present
...
```

No database dump is committed. Override sizes with `SEED_CUSTOMERS`, `SEED_RESTAURANTS`, `SEED_ORDERS`.

---

## Testing

```bash
cd api
npm test            # unit tests (cursor codec, pagination, filter, seed dataset, status rules)
npm run test:e2e    # HTTP tests against a real Postgres (the TEST_DATABASE_URL database is migrated and seeded first)
npm run lint
```

The e2e suite drives the same pipeline as production and covers: every bad-input case in the brief (limit 5000, negative offset, unknown sort, malformed id, missing required field), walking every page of several lists by cursor with no gaps or duplicates (forwards and back), all filters, order creation/update/delete including illegal transitions and a concurrency check, CORS, and the 429 response.

---

## Deployment

The API is deployed on Render (Blueprint in `render.yaml`) with a managed PostgreSQL database.

1. In Render choose **New > Blueprint** and select this repository; it reads [`render.yaml`](render.yaml) and creates the API web service and a managed PostgreSQL database.
2. Fill in `CORS_ORIGINS` with the consumer's URL (no trailing slash). `DATABASE_URL` is wired to the database automatically; the other variables have defaults in the Blueprint.
3. Build command `npm ci --include=dev && npm run build`; start command `npm run start:render` (applies migrations, runs the idempotent seed, starts the API); health check path `/health`. Set `NODE_VERSION` to `22`.
4. The seed runs against production on every boot; it inserts nothing once the data is loaded. You can also run it by hand with the database's external URL: `DATABASE_URL=<external url> npm run db:seed`.
5. Confirm: `curl https://<service>.onrender.com/api/v1/restaurants?limit=1` returns `meta.total` of 300.

Behind Render the request passes through Cloudflare and Render's router, so the app trusts three proxy hops (`TRUST_PROXY_HOPS=3`, applied automatically on Render). With too few hops every visitor would share one proxy address and the rate limit would not work; this was found and fixed while testing the live deployment.

---

## Design decisions

**Why these resources.** Food delivery has natural, genuinely related data: restaurants own menus, customers place orders, and orders snapshot menu items. Five resources with real foreign keys exercise nested routes (`/restaurants/:id/menu`, `/customers/:id/orders`), a write path with business rules (orders), and lists large enough (hundreds to thousands of rows) to make pagination matter.

**Why generated identifiers.** Sequential integers let anyone enumerate the dataset by counting `/orders/1`, `/orders/2`, … and reveal volume. UUIDs are unguessable and can be created without asking the database. A malformed id (`/orders/42`) answers `404`, because a value that can never exist is simply not found, and it never reaches Postgres.

**Why cursor pagination (and why offset is still there).** With `OFFSET n`, Postgres must read and throw away `n` rows, so deep pages get slower, and when rows are inserted or deleted while someone pages, items shift: they see duplicates or miss rows. Cursor (keyset) pagination asks for "rows after this one" using the sort value and id of the last row seen, which uses the index, costs the same at any depth, and stays stable under concurrent writes. The tradeoff: you can't jump to "page 37" and the cursor is only valid for the `sort`/`order` it was issued for. For infinite-scroll and "next page" UIs, which is how people consume this API, that is the right trade. Offset remains available (`?offset=`) for the cases that need random access. Mechanics: results are ordered by `(sortField, id)` so ordering is total even when many rows share a value; one extra row is fetched to compute `hasMore` without a second query; the cursor stores the last row's sort value and id, so it keeps working even if that row is deleted.

**Envelope shape.** Success is `{ data, meta? }` and failure is `{ error: { code, message, details? } }`, in every endpoint. Clients write one parser, can tell success from failure by the key (and by the HTTP status, which is always honest: 4xx/5xx never carry a `data` body, 2xx never carry an `error`). `code` is a stable machine-readable string, `message` is for humans, `details` carries field-level problems. `meta` always has the same six keys so clients never need to check which are present.

**Money as integer kobo.** Floating point can't represent 0.1 exactly; adding prices in floats produces totals like ₦3,059.9999. Integers are exact, and kobo is the smallest unit that payment providers (Paystack, Flutterwave) use anyway. Fields are named `…Kobo` so the unit can't be mistaken. Order totals are computed by the server from the current menu prices and snapshotted per line, so later menu price changes never alter an existing order.

**Rate limit.** 100 requests/minute/IP keeps casual scripts and the demo UI comfortable while blunting scraping and brute-force abuse of an open API. It's applied to every route through a global guard, keyed on the client IP, with numbers in configuration rather than handlers. The limiter only counts requests that match a route, so random-path scanners get a `404` without consuming quota; those requests are cheap and don't touch the database.

**Business rules chosen for orders.** Orders can only be placed with an open restaurant and available items from that restaurant; status moves forward along a fixed path (or to `cancelled` early on); the delivery address can change only before dispatch; PATCH can't touch totals or ownership. Updates guard on the status they validated, so two simultaneous conflicting updates can't both succeed.

**Other choices.** Request bodies are validated with `class-validator` DTOs (`422`, field-named), query strings with the same mechanism (`400`); unknown properties and parameters are rejected. Ratings are non-null (default 0) so sort cursors never have to deal with NULL ordering. Seed data is generated, not scraped, with a fixed seed so tests and docs are reproducible.
