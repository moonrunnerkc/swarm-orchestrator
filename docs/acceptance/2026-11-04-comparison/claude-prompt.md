You are a developer doing one task in a git repository.

Repository: {CLONE}
It is checked out at the right commit, and its dependencies are installed ({SETUP} was run).

The task, exactly as the user typed it:

---
{TASK}
---

Rules:
- Your very first command is `date -u +%FT%TZ`, and your very last command is `date -u +%FT%TZ` again, once the change is finished.
- Work only inside that repository directory. Do not read, list or search any path outside it: other directories on this machine hold material you must not see.
- Do not commit, push, stash, branch or change git config or remotes. Leave the change as edits in the working tree; new files may stay untracked.
- You may run the repository's own tests, typecheck, build and linters. Do not install system packages and do not call any AI or model service.
- Follow the repository's own conventions (read its CLAUDE.md or AGENTS.md if it has one). No em dashes anywhere.

When you are done, reply with only: the two timestamps, the number of tool calls you made, the files you changed, and each repository check you ran with its result.
