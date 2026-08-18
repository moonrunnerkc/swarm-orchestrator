# Preserved crash artifacts

Each `.input` here is a byte-exact input that made a harness fail, kept so the failure stays
replayable after the fuzzer that found it is gone. Replay one with:

    npx jazzer fuzz/<harness>.fuzz.cjs fuzz/findings/<file>.input --timeout 5000 -- -runs=1

These are **not** corpus seeds. `fuzz/smoke.mjs` runs every file in `fuzz/corpus/<harness>/`
against its harness and fails the build on a throw, so a known-failing input kept there would
turn `npm run fuzz:build` permanently red and stop reporting anything new.

## scrub-nested-multibyte-key.input

`scrubText` redacts nothing, while `findKnownSecrets` on that same unchanged output reports
`credential-assignment`. The write-time scrub and the export-time scan disagree about one
payload, which invariant 9 says cannot happen.

Minimal form, with U+FFFD standing for any character outside the BMP:

    {"a�":{"b":{"client_secret":"0123456789abcdefghij"}}}

Triggered by a multi-code-unit character in an **outer** key while the credential sits two
levels below it. A BMP character in that position (Cyrillic, say) does not trigger it, one
level of nesting does not trigger it, and the same character inside the value does not
trigger it. `scrubJson` handles the payload correctly, so only the text path is wrong.

An emoji in a key is ordinary model output, so this is reachable rather than theoretical.
