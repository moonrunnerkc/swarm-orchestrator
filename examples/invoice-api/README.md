# Invoice API example

A small TypeScript API with no dependencies: users sign in with a bearer token and list their own
invoices. The users, tokens and invoices in `src/data.ts` are synthetic fixtures. It needs Node 24.

The task in `task.txt` adds a download route. An obvious way to write it serves any signed-in
user any invoice, and an ordinary test of "the owner can download" does not notice. This example
shows Swarm noticing and repairing it.

## Run it

Swarm works in a git repository of its own, so copy the example out first:

```sh
cp -R examples/invoice-api ~/invoice-api && cd ~/invoice-api
git init -q && git add -A && git commit -qm "base"

# 1. Learn conventions from the sources, read the proposal, approve it.
swarm init --learn src
swarm init --approve ~/.swarm/conventions/proposals/<the file it printed>
swarm doctor --conventions

# 2. Run the task. Swarm drafts the acceptance test and the security binding itself and, at a
#    terminal, shows you each one to approve, edit or reject before it edits anything.
swarm run "$(cat task.txt)"
```

A later run in the same repository uses the approved profile without asking again. To run
without a terminal and without reading the drafts, add `--accept-authored`; the report then says
nobody reviewed them. To stand behind checks of your own instead, pass them:

```sh
swarm run "$(cat task.txt)" \
  --accept <swarm checkout>/examples/invoice-api-checks/feature \
  --security-check security.json
```

## What to expect

- The summary lists three requirements: R1, the task; one with source `profile`, the approved
  conventions on the files the run changed; one with source `security`, ownership.
- The drafted test starts the application the way `src/server.ts` does and sends it requests.
  It fails before the change because the route answers 404, and for no other reason.
- The binding, drafted or yours, is tried before the first edit: the server is started and each
  user it names must be one the server knows.
- The ownership check starts `node src/server.ts` and sends its requests straight to it: each
  named user signs in, another customer, a member of support and nobody are each refused the
  invoice, and the owner is served.
- Where a version of the change serves another customer, the verifier reports the requirement
  `failed` with the request and the status it got, the model reads that, and the run goes on
  until the server refuses it or the budget ends. It is never reported complete in between.
- `security.json` in the run's own copy of the tree is not the one that judges: a binding is
  read from your path, or drafted and kept in the session, before the model starts.

`examples/invoice-api-checks/repair` is the acceptance test for a second task: start from a
download route that serves any signed-in user, and ask Swarm to restrict it to the owner.
`examples/invoice-api-checks/seeded` holds that faulty route with a task that does not mention
it, for watching the security requirement find the fault and the run repair it.
[examples/notes-api](../notes-api/README.md) is a second API, shaped another way.

`security.json` here is a binding written by hand (`user-acceptance` when you pass it). What the
three checks cover is listed in the [reference](../../docs/reference.md#security-binding); they
are not a security review.
