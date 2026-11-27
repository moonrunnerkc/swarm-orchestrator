# A seeded ownership fault, for showing detection and repair

`overlay/src/app.ts` is the invoice example's `app.ts` with a download route that has a fault put
there on purpose: it serves any signed-in user any invoice. Nothing in the file says so, since a
model reads it. `task.txt` asks for an unrelated addition to that route and does not mention the
fault. `test/currency.accept.test.ts` is an independent acceptance test for judging the result.

Lay the overlay over a copy of `examples/invoice-api` before the first commit and run the task.
Ownership applies (the task names the invoice's owner), so the run carries a security
requirement whose check finds another customer served at the base. A change that adds the field
and leaves the fault does not complete: the verifier reports the request and the status it got,
the model reads that, and the run goes on until the server refuses the request or the budget
ends. This is a seeded fault, not a mistake a model made on its own.
