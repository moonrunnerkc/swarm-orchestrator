# Follow-ups

One line per thing deliberately not done, each of which would change the product's shape, with
why it waits.

- An edit whose SEARCH part differs from the file only in indentation or blank lines is refused and the file's lines shown; applying it would need the replacement re-indented to match, which is wrong for a language where indentation carries meaning unless done per language. It waits on a rule that is safe for Python.
- The time rule sizes the next turn by the longest turn so far, so one slow reply can end a run with minutes left; sizing by a typical turn waits on live runs that show it does not overrun the time kept for final verification.
- The checks that decide whether a drafted test is usable (`src/agent/authored-validation.ts`) still read runner output by pattern in places; moving them onto the runners' structured reports throughout waits because it changes which drafts are admitted and needs its own live comparison.
- A Python project's dependency install builds packages with the network open, inside the container, as Yarn 2 and later and bun run theirs; fetching first and building with the network closed needs a rule per backend and package manager, and waits on a project that shows the need. npm, pnpm and classic yarn already run no install script while the network is open.
- Security checks cover three classes for JavaScript and TypeScript HTTP APIs whose server starts from one command; a target that needs a database or another service beside it waits on a way to declare one.
- Each contained command starts a fresh container, about two seconds on macOS; one long-lived container per run would be faster and would let a background process outlive its command, which changes what a command can leave behind and needs its own review.
