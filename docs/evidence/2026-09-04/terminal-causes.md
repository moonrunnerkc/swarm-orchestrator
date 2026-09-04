# Terminal causes of the campaign's non-green runs

Generated on 2026-09-04 by `scripts/terminal-causes.mjs` over every executed bundle of the
first campaign's two arms and the second campaign's `local-mlx` arm as far as it ran:

    node scripts/terminal-causes.mjs campaign/corpus/local-mlx/* campaign/corpus/local-ollama/* campaign/campaigns/fixed-cli/corpus/local-mlx/*

One cause per run, by the first of five rules that fires, each rule reading the ledger and
nothing else; the signals every rule read are in the row. These bundles predate the
`gate-baseline` record, so where a gate failed at the base tree the rule that fires is the
retry rule, on the same failure every attempt. Reading those rows' gate output settles what
the base held: every `lint` row on a Rust repository is `cargo-clippy is not installed for
the toolchain`, the Go `lint` rows are `go vet` diagnostics in files the run never touched,
the `typecheck` rows are mypy over the repository's own untyped files or a package name mypy
refuses, and the `format` rows are ruff over files the run never touched. Those twenty-six
rows are pre-existing failures at the base, which is the cause the base measurement now
records by name.

| run | cause | why | stop | escalated | attempts | edits refused | repeats |
| --- | --- | --- | --- | --- | --- | --- | --- |
| local-mlx/abiosoft__colima | environment | the format gate failed on 36 path(s) under a dependency directory the run never touched | max-steps | format | 2 of 2 | 0 | 87 |
| local-mlx/ajeetdsouza__zoxide | retry | every attempt left the lint gate failing the same way | max-steps | lint | 2 of 2 | 0 | 68 |
| local-mlx/Caligatio__jsSHA | retry | every attempt left the tests gate failing the same way | max-steps | tests | 2 of 2 | 0 | 37 |
| local-mlx/charmbracelet__bubbletea | environment | the format gate failed on 4 path(s) under a dependency directory the run never touched | completed | format | 2 of 2 | 0 | 34 |
| local-mlx/dandavison__delta | retry | every attempt left the lint gate failing the same way | max-steps | lint | 2 of 2 | 0 | 96 |
| local-mlx/darkreader__darkreader | retry | every attempt left the tests gate failing the same way | max-tokens | tests | 2 of 2 | 0 | 77 |
| local-mlx/gitleaks__gitleaks | retry | every attempt left the lint gate failing the same way | completed | lint | 2 of 2 | 0 | 0 |
| local-mlx/googlemaps__google-maps-services-js | retry | every attempt left the lint gate failing the same way | model-error | lint | 2 of 2 | 0 | 0 |
| local-mlx/hubotio__hubot | editor | 2 refused edit(s) and 0 repeated call(s) | model-error | tests | 2 of 2 | 2 | 0 |
| local-mlx/iamkun__dayjs | editor | 0 refused edit(s) and 39 repeated call(s) | max-steps | tests | 2 of 2 | 0 | 39 |
| local-mlx/JedWatson__classnames | planner | the first edit preceded any declaration naming its file | completed | file-set | 2 of 2 | 0 | 0 |
| local-mlx/jesseduffield__lazydocker | environment | the format gate failed on 261 path(s) under a dependency directory the run never touched | max-steps | format | 2 of 2 | 0 | 114 |
| local-mlx/jhlywa__chess.js | editor | 0 refused edit(s) and 3 repeated call(s) | max-tokens | tests | 2 of 2 | 0 | 3 |
| local-mlx/keon__algorithms | retry | every attempt left the typecheck gate failing the same way | model-error | typecheck | 2 of 2 | 0 | 0 |
| local-mlx/koajs__koa | retry | every attempt left the tests gate failing the same way | max-steps | tests | 2 of 2 | 0 | 19 |
| local-mlx/micro-editor__micro | retry | every attempt left the lint gate failing the same way | max-steps | lint | 2 of 2 | 0 | 80 |
| local-mlx/openai__codex-plugin-cc | planner | the first edit preceded any declaration naming its file | completed | file-set | 2 of 2 | 0 | 0 |
| local-mlx/sharkdp__bat | retry | every attempt left the lint gate failing the same way | max-steps | lint | 2 of 2 | 0 | 51 |
| local-mlx/sharkdp__fd | retry | every attempt left the lint gate failing the same way | model-error | lint | 2 of 2 | 0 | 137 |
| local-mlx/sharkdp__hyperfine | retry | every attempt left the lint gate failing the same way | model-error | lint | 2 of 2 | 0 | 50 |
| local-mlx/spf13__viper | environment | the format gate failed on 29 path(s) under a dependency directory the run never touched | max-steps | format | 2 of 2 | 0 | 24 |
| local-mlx/SuperClaude-Org__SuperClaude_Framework | retry | every attempt left the typecheck:python gate failing the same way | model-error | typecheck:python | 2 of 2 | 0 | 225 |
| local-mlx/TauricResearch__TradingAgents | retry | every attempt left the format gate failing the same way | max-steps | format | 2 of 2 | 0 | 29 |
| local-mlx/uuidjs__uuid | retry | every attempt left the format gate failing the same way | max-steps | format | 2 of 2 | 0 | 99 |
| local-mlx/Z4nzu__hackingtool | retry | every attempt left the tests gate failing the same way | max-steps | tests | 2 of 2 | 1 | 49 |
| local-ollama/abiosoft__colima | environment | the format gate failed on 36 path(s) under a dependency directory the run never touched | max-tokens | format | 2 of 2 | 0 | 0 |
| local-ollama/ajeetdsouza__zoxide | retry | every attempt left the lint gate failing the same way | max-steps | lint | 2 of 2 | 0 | 0 |
| local-ollama/browser-use__browser-harness | model | stopped as output-cap and escalated at tests | output-cap | tests | 2 of 2 | 0 | 0 |
| local-ollama/Caligatio__jsSHA | retry | every attempt left the tests gate failing the same way | output-cap | tests | 2 of 2 | 0 | 0 |
| local-ollama/charmbracelet__bubbletea | environment | the format gate failed on 4 path(s) under a dependency directory the run never touched | completed | format | 2 of 2 | 0 | 1 |
| local-ollama/dandavison__delta | retry | every attempt left the lint gate failing the same way | max-tokens | lint | 2 of 2 | 1 | 0 |
| local-ollama/freestylefly__awesome-gpt-image-2 | planner | the first edit preceded any declaration naming its file | completed | file-set | 2 of 2 | 0 | 0 |
| local-ollama/gigobyte__purify | planner | the first edit preceded any declaration naming its file | completed | file-set | 2 of 2 | 1 | 0 |
| local-ollama/gitleaks__gitleaks | retry | every attempt left the lint gate failing the same way | max-tokens | lint | 2 of 2 | 0 | 0 |
| local-ollama/gvergnaud__ts-pattern | planner | the first edit preceded any declaration naming its file | completed | file-set | 2 of 2 | 0 | 0 |
| local-ollama/hubotio__hubot | planner | the first edit preceded any declaration naming its file | completed | file-set | 2 of 2 | 0 | 0 |
| local-ollama/imsnif__bandwhich | retry | every attempt left the lint gate failing the same way | max-tokens | lint | 2 of 2 | 0 | 0 |
| local-ollama/JedWatson__classnames | planner | the first edit preceded any declaration naming its file | completed | file-set | 2 of 2 | 0 | 0 |
| local-ollama/jesseduffield__lazydocker | model | stopped as max-tokens and escalated at format | max-tokens | format | 2 of 2 | 0 | 2 |
| local-ollama/jgraph__drawio-desktop | planner | the first edit preceded any declaration naming its file | completed | file-set | 2 of 2 | 0 | 0 |
| local-ollama/jhlywa__chess.js | planner | the first edit preceded any declaration naming its file | completed | file-set | 2 of 2 | 0 | 2 |
| local-ollama/keon__algorithms | model | stopped as completed and escalated at typecheck | completed | typecheck | 2 of 2 | 0 | 0 |
| local-ollama/KittenML__KittenTTS | retry | every attempt left the tests gate failing the same way | output-cap | tests | 2 of 2 | 0 | 0 |
| local-ollama/micro-editor__micro | model | stopped as max-tokens and escalated at lint | max-tokens | lint | 2 of 2 | 0 | 0 |
| local-ollama/mlc-ai__web-llm | planner | the first edit preceded any declaration naming its file | completed | file-set | 2 of 2 | 0 | 1 |
| local-ollama/sharkdp__bat | model | stopped as max-tokens and escalated at lint | max-tokens | lint | 2 of 2 | 0 | 1 |
| local-ollama/sharkdp__fd | retry | every attempt left the lint gate failing the same way | completed | lint | 2 of 2 | 0 | 0 |
| local-ollama/sharkdp__hyperfine | retry | every attempt left the lint gate failing the same way | completed | lint | 2 of 2 | 0 | 1 |
| local-ollama/spf13__viper | environment | the format gate failed on 29 path(s) under a dependency directory the run never touched | empty-response | format | 2 of 2 | 0 | 0 |
| local-ollama/SuperClaude-Org__SuperClaude_Framework | retry | every attempt left the typecheck:python gate failing the same way | output-cap | typecheck:python | 2 of 2 | 0 | 2 |
| local-ollama/TauricResearch__TradingAgents | retry | every attempt left the format gate failing the same way | max-steps | format | 2 of 2 | 0 | 0 |
| local-ollama/tj__commander.js | planner | the first edit preceded any declaration naming its file | completed | file-set | 2 of 2 | 0 | 1 |
| local-ollama/uuidjs__uuid | model | stopped as completed and escalated at format | completed | format | 2 of 2 | 0 | 0 |
| local-ollama/virattt__ai-hedge-fund | retry | one empty response ended the loop, and nothing sampled it again | empty-response | tests | 2 of 2 | 0 | 0 |
| local-ollama/virgiliojr94__book-to-skill | model | stopped as output-cap and escalated at tests | output-cap | tests | 2 of 2 | 0 | 0 |
| local-ollama/Z4nzu__hackingtool | model | stopped as max-tokens and escalated at tests | max-tokens | tests | 2 of 2 | 1 | 1 |
| local-ollama/Zulko__moviepy | model | stopped as max-tokens and escalated at tests | max-tokens | tests | 2 of 2 | 0 | 0 |
| local-mlx/abiosoft__colima | environment | the format gate failed on 36 path(s) under a dependency directory the run never touched | completed | format | 2 of 2 | 0 | 77 |
| local-mlx/Caligatio__jsSHA | model | stopped as model-error and escalated at tests | model-error | tests | 1 of 2 | 0 | 0 |
| local-mlx/charmbracelet__bubbletea | environment | the format gate failed on 4 path(s) under a dependency directory the run never touched | max-steps | format | 2 of 2 | 0 | 15 |
| local-mlx/cool-RR__PySnooper | model | stopped as model-error and escalated at tests | model-error | tests | 1 of 2 | 0 | 0 |
| local-mlx/darkreader__darkreader | planner | the first edit preceded any declaration naming its file | completed | file-set | 2 of 2 | 0 | 2 |
| local-mlx/gitleaks__gitleaks | retry | every attempt left the lint gate failing the same way | completed | lint | 2 of 2 | 0 | 0 |
| local-mlx/googlemaps__google-maps-services-js | retry | every attempt left the lint gate failing the same way | completed | lint | 2 of 2 | 0 | 61 |
| local-mlx/iamkun__dayjs | editor | 0 refused edit(s) and 25 repeated call(s) | completed | tests | 2 of 2 | 0 | 25 |
| local-mlx/jesseduffield__lazydocker | environment | the format gate failed on 261 path(s) under a dependency directory the run never touched | completed | format | 2 of 2 | 0 | 0 |
| local-mlx/keon__algorithms | retry | every attempt left the typecheck gate failing the same way | completed | typecheck | 2 of 2 | 0 | 0 |
| local-mlx/micro-editor__micro | retry | every attempt left the lint gate failing the same way | completed | lint | 2 of 2 | 0 | 0 |
| local-mlx/refined-github__refined-github | model | stopped as max-steps and escalated at lint | max-steps | lint | 2 of 2 | 0 | 0 |
| local-mlx/remy__nodemon | planner | the first edit preceded any declaration naming its file | completed | file-set | 2 of 2 | 0 | 29 |
| local-mlx/spf13__viper | environment | the format gate failed on 29 path(s) under a dependency directory the run never touched | completed | format | 2 of 2 | 0 | 62 |
| local-mlx/SuperClaude-Org__SuperClaude_Framework | retry | every attempt left the typecheck:python gate failing the same way | completed | typecheck:python | 2 of 2 | 0 | 0 |
| local-mlx/TauricResearch__TradingAgents | retry | every attempt left the format gate failing the same way | completed | format | 2 of 2 | 0 | 0 |

Tally: environment 11, planner 13, retry 33, editor 4, model 12 over 73 non-green run(s).
