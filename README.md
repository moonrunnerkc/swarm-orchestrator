# Swarm Orchestrator

This repository is being rebuilt as two small products on one implementation
([ADR 0014](docs/adr/0014-verifier-first-rebuild.md)):

- **swarm-verify**, a verifier that reruns a project's declared checks on a change in a clean
  checkout and records a signed verdict anyone can check offline.
- **swarm run**, a plain single-bash-tool agent loop that calls the verifier.

During the rebuild the `swarm` command has `verify`, `init`, `ci` and `doctor`; `run` returns
as the new loop. Research evidence from earlier versions moved to the archive named in
[docs/evidence/README.md](docs/evidence/README.md).

```sh
npm install
npm run gates          # checks, typecheck, lint, tests
node src/cli.ts --help
```

Integrations are described in [docs/integrations.md](docs/integrations.md). Measured results,
when they exist, are only in [docs/results.md](docs/results.md).

## License

ISC. See [LICENSE](LICENSE).
