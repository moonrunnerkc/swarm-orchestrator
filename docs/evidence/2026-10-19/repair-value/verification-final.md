# Verification of the branch head before push

`npm run gates` and the release checks, run on the branch head in a clean clone with full history,
`npm ci` first, Node 24.15.0, with no model resident and nothing else running. The commit they ran
on is the parent of the commit that records the results below; that recording commit adds this
section's results and the logs beside it, and nothing else.
