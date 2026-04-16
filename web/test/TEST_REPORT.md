# Inkwell Frontend Test Report

**Date:** 2026-04-16
**Runner:** Node.js built-in test runner (`node --test`)

## Summary

| Suite | Tests | Pass | Fail |
|-------|-------|------|------|
| api.test.js (API client unit) | 14 | 14 | 0 |
| integration-api.test.js (frontend→backend HTTP) | 12 | 12 | 0 |
| audio-cue.test.js | 5 | 5 | 0 |
| markdown.test.js | 8 | 8 | 0 |
| notes-store.test.js | 7 | 7 | 0 |
| **Total** | **46** | **46** | **0** |

## New Tests Added

### api.test.js — API Client Unit Tests (14 tests)

Tests `web/src/api.js` with a stubbed `fetch` to verify:

- **fetchNotes**: Returns notes with `content` → `body` field mapping; calls GET `/api/notes`
- **fetchNote**: Returns single note by ID with correct mapping
- **createNote**: Sends POST with `body` → `content` mapping; defaults title to "Untitled"
- **updateNote**: Sends PUT with partial field mapping; title defaults when empty
- **deleteNote**: Sends DELETE, returns undefined
- **Error handling**: Surfaces API error messages; falls back to status code for non-JSON errors
- **Field mapping edge cases**: `null` content maps to empty string; ISO dates convert to epoch ms

### integration-api.test.js — Frontend→Backend Integration Tests (12 tests)

Starts a real `notes-api` HTTP server and exercises the frontend API client over actual network calls:

- Full CRUD lifecycle: create → list → get → update → partial update → verify → delete → confirm gone
- Edge cases: empty arguments, empty body, multiple rapid concurrent creates
- Validation: rejects invalid title type with proper error
- Verifies `body` ↔ `content` field mapping works end-to-end

## Coverage

All frontend API client functions are tested:
- `fetchNotes`, `fetchNote`, `createNote`, `updateNote`, `deleteNote`
- Field mapping: `toLocal` (content→body), `toRemoteCreate` (body→content), `toRemoteUpdate`
- Error handling in `request()` helper
- Integration with real backend server validates contract correctness
