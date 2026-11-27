# Invites API example

A small TypeScript API with no dependencies: a team's owner issues an invite, and whoever holds
its token joins the team by accepting it, once. The users and tokens in `src/data.ts` are
synthetic fixtures. It needs Node 24.

**The base holds a fault placed there on purpose.** `src/config.ts` reads how long an invite
lasts (`INVITE_TTL_MS`, a day by default) and the issue response states an `expiresAt`, but
accepting an invite never looks at either: an invite works forever. `task.txt` asks for that to
be repaired. Reuse and unknown tokens are already refused.

The single-use token check applies. Its expiry case needs a server whose invites last about a
second, which `INVITE_TTL_MS` gives; `security.json` is a binding written by hand that sets it,
kept for judging a run apart from anything the run drafted. A binding with no `expiresAfterMs`
leaves expiry unexercised and the run incomplete.

```sh
cp -R examples/invites-api ~/invites-api && cd ~/invites-api && rm security.json
git init -q && git add -A && git commit -qm "base"
swarm run "$(cat task.txt)" --no-security ownership
```

`--no-security ownership` answers a question the run would otherwise stop on: the task changes
a request handler, and accepting an invite is not restricted to an owner.
