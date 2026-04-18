# Contributing

## Development

Get started: `npm install && npm run build && npm test`

- TypeScript strict mode, ES2020 target
- All source files use the structured logger (`src/logger.ts`) — no raw `console.log/error/warn`
- Before submitting a PR: run `npm test`, run `swarm gates .`, and keep commits descriptive

## Sub-Project Tests

Sub-project tests run independently inside their directories:

```bash
cd calculations-api && npm install && npm test
cd notes-api && npm install && npm test
cd calculator && npm test
cd logtail && npm test
cd web && npm test
cd tictactoe && npm test
pytest app/tests/ -v
```

Sub-projects that use only Node.js built-ins (`calculator/`, `logtail/`, `tictactoe/`) need no install step. Others require `npm install` first.
