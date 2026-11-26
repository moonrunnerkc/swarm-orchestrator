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

# 2. Run the task. The acceptance test is yours (it lives beside this example, outside the
#    repository the model works in); security.json says how to start the server and who owns inv-1.
swarm run "$(cat task.txt)" \
  --accept <swarm checkout>/examples/invoice-api-checks/feature \
  --security-check security.json
```

A later run in the same repository uses the approved profile without asking again.

## What to expect

- The summary lists three requirements: R1, the task; one with source `profile`, the approved
  conventions on the files the run changed; one with source `security`, ownership.
- The ownership check starts `node src/server.ts` and sends four requests straight to it: the
  owner (served), another customer, a member of support and nobody (each refused).
- Where the model's first version serves another customer, the verifier reports the requirement
  `failed` with the request and the status it got, the model reads that, and the run goes on
  until the server refuses it or the budget ends. It is never reported complete in between.
- `security.json` in the run's own copy of the tree is not the one that judges: the file is read
  from your path before the model starts.

`examples/invoice-api-checks/repair` is the acceptance test for a second task: start from a
download route that serves any signed-in user, and ask Swarm to restrict it to the owner.

`security.json` is a binding you stand behind (`user-acceptance`). Without `--security-check` a
separate model call drafts one from the repository; the report then says nobody reviewed it and
where it was written.
