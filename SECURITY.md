# Security

A way to make the verifier accept a change it should refuse, to run agent-authored commands
outside the path policy, or to reach evidence, signing keys or credentials is a security
report. Report it privately through
[a GitHub security advisory](https://github.com/moonrunnerkc/swarm-orchestrator/security/advisories/new),
not as a public issue. Include the version and a reproduction.

Response: an acknowledgement within 48 hours, then a fix or a written assessment once the
report is reproduced. Reporters are credited in the release notes with their consent.

Limits, stated rather than implied: the path policy is lexical, not a sandbox; an allowed
interpreter can run workspace-authored code; known-pattern scrubbing is not secret removal.
