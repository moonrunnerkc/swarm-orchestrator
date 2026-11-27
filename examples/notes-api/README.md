# Notes API example

A second small TypeScript API with no dependencies, unlike the invoice example where it matters
to a check's author: the sources are under `service/` and the tests under `spec/`, routes are
rows of a table, an account signs in with an `x-api-key` header, a note belongs to its
`authorId`, and the service is started by `startService(port)`. The accounts and keys in
`service/store.ts` are synthetic fixtures. It needs Node 24.

`task.txt` adds a route that deletes a note. Ownership applies, and the check's request removes
the resource, so the refusals are asked before the owner's own request.

```sh
cp -R examples/notes-api ~/notes-api && cd ~/notes-api
git init -q && git add -A && git commit -qm "base"
swarm run "$(cat task.txt)"
```

`security.json` is a binding written by hand, and `examples/notes-api-checks` an acceptance
test written by hand, for judging a run's result apart from anything the run drafted.
