# Calculations API

Express API that evaluates arithmetic expressions and persists them to a
JSON file. Supports full CRUD, input validation, CORS, and proper error
responses.

## Quick start

```sh
cp .env.example .env   # edit as needed
npm install
npm start              # http://127.0.0.1:3001
```

## Endpoints

| Method | Path                  | Description                |
| ------ | --------------------- | -------------------------- |
| GET    | `/health`             | Liveness probe             |
| GET    | `/calculations`       | List all calculations      |
| POST   | `/calculations`       | Create a new calculation   |
| GET    | `/calculations/:id`   | Get a single calculation   |
| PUT    | `/calculations/:id`   | Update a calculation       |
| DELETE | `/calculations/:id`   | Delete a calculation       |

### Request / response shapes

**POST /calculations**

```json
// request
{ "expression": "2 + 3 * 4", "title": "order of operations demo" }

// response — 201
{
  "id": "a1b2c3d4-...",
  "title": "order of operations demo",
  "expression": "2 + 3 * 4",
  "result": 14,
  "createdAt": "2026-04-16T21:00:00.000Z",
  "updatedAt": "2026-04-16T21:00:00.000Z"
}
```

**PUT /calculations/:id** — send any combination of `title` and `expression`.
When `expression` changes the `result` is recalculated.

**Field reference:**

| Field        | Type               | Notes                                  |
| ------------ | ------------------ | -------------------------------------- |
| `id`         | UUID v4            | Auto-generated                         |
| `title`      | `string` or `null` | Optional, max 100 chars, trimmed       |
| `expression` | `string`           | Required on create, max 200 chars      |
| `result`     | `number`           | Computed from expression               |
| `createdAt`  | ISO 8601 string    | Set once                               |
| `updatedAt`  | ISO 8601 string    | Updated on every mutation              |

### Error responses

Every error follows this shape:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "'expression' must be a string, got number",
    "details": { "field": "expression", "received": "number" }
  }
}
```

Error codes: `VALIDATION_ERROR` (400), `EVALUATION_ERROR` (422),
`NOT_FOUND` (404), `ROUTE_NOT_FOUND` (404), `INVALID_JSON` (400),
`PAYLOAD_TOO_LARGE` (413), `INTERNAL_ERROR` (500).

### Expression syntax

Supports `+`, `-`, `*`, `/`, parentheses, decimal numbers, unary sign,
and scientific notation (e.g. `1e3`). Standard operator precedence applies.
Division by zero returns 422.

## Configuration

All config is read from environment variables (see `.env.example`):

| Variable        | Default                        | Description                 |
| --------------- | ------------------------------ | --------------------------- |
| `PORT`          | `3001`                         | Server port                 |
| `HOST`          | `127.0.0.1`                    | Bind address                |
| `DATA_FILE`     | `./data/calculations.json`     | Path to JSON storage file   |
| `CORS_ORIGIN`   | `*`                            | Allowed origin(s), comma-separated |
| `LOG_REQUESTS`  | `false`                        | Log every request to stdout |

## Tests

```sh
npm test            # 118 tests, ~540ms
npm run test:coverage
```
