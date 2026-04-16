# notes-api

Express API with CRUD operations for notes, backed by JSON file storage.

## Setup

```bash
npm install
npm start        # starts on http://127.0.0.1:3002
npm run dev      # starts with --watch for auto-reload
npm test         # runs all tests
npm run test:coverage  # runs tests with coverage report
```

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3002` | Server port |
| `HOST` | `127.0.0.1` | Bind address |
| `DATA_FILE` | `./data/notes.json` | Path to the JSON data file |
| `CORS_ORIGIN` | `*` | Allowed origins (comma-separated for multiple) |
| `LOG_REQUESTS` | `false` | Log incoming requests to stdout |

## API

### `GET /health`

Returns service status, version, and uptime.

### `GET /notes`

List all notes.

**Response:** `{ items: Note[], count: number }`

### `GET /notes/:id`

Get a single note by UUID.

**Response:** `Note`

### `POST /notes`

Create a new note.

**Request body:**
```json
{
  "title": "string (required, max 200 chars)",
  "content": "string (optional, max 10000 chars, defaults to empty string)"
}
```

**Response:** `201` with the created `Note`

### `PUT /notes/:id`

Update an existing note. At least one of `title` or `content` must be provided.

**Request body:**
```json
{
  "title": "string (optional)",
  "content": "string (optional)"
}
```

**Response:** `200` with the updated `Note`

### `DELETE /notes/:id`

Delete a note.

**Response:** `204 No Content`

### Note schema

```json
{
  "id": "UUID v4",
  "title": "string",
  "content": "string",
  "createdAt": "ISO-8601 timestamp",
  "updatedAt": "ISO-8601 timestamp"
}
```

### Error responses

All errors follow this shape:

```json
{
  "error": {
    "code": "VALIDATION_ERROR | NOT_FOUND | ROUTE_NOT_FOUND | INVALID_JSON | PAYLOAD_TOO_LARGE | RATE_LIMITED | UNSUPPORTED_MEDIA_TYPE | INTERNAL_ERROR",
    "message": "Human-readable description",
    "details": {}
  }
}
```
