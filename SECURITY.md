# Security

A way to make the verifier accept work it should refuse, to make the agent's gates pass work
they should refuse, to run candidate or agent-authored code outside the boundary the run
declared, or to reach evidence, signing material or credentials is a security report. This
covers both Swarm Orchestrator and the standalone Swarm Verify, whose implementation lives here. Report it privately through
[a GitHub security advisory](https://github.com/moonrunnerkc/swarm-orchestrator/security/advisories/new),
not as a public issue. Include the version, the route and a reproduction; the scrubbed
evidence bundle helps.

Response: an acknowledgement within 48 hours, a fix or a written assessment as soon as it is
verified, and a compatible release through the ordinary gates. Reporters are credited in the
release notes with their consent.

Scope and limits, stated rather than implied: the default host mode is a policy, not a
sandbox; container isolation is measured per run; known-pattern scrubbing is not secret
removal. `docs/verifier-first/attack-controls.md` lists the twelve attack families this
project tests against and what each control does and does not establish.
