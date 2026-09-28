#!/bin/bash
export PS1='$ '
say() { printf '\033[1;36m$ %s\033[0m\n' "$1"; sleep 1.2; }
cd "$(dirname "$0")"
say "npx swarm-verify@1.0.0 verify bundle --signer sha256:db270183c40c65843cacd2b3dcf20ee249d146d98c56699b2f3512ebeb84a52a"
npx -y swarm-verify@1.0.0 verify bundle --signer sha256:db270183c40c65843cacd2b3dcf20ee249d146d98c56699b2f3512ebeb84a52a 2>/dev/null | grep -E "^integrity|^  PASS  hash chain|^bundle verified|^signer" ; echo "exit $?"
sleep 2
say "node flip-one-byte.mjs bundle tampered    # one byte of record 28's timestamp"
node flip-one-byte.mjs bundle tampered 2>&1 | tail -2
sleep 2
say "npx swarm-verify@1.0.0 verify tampered --signer sha256:db270183c40c65843cacd2b3dcf20ee249d146d98c56699b2f3512ebeb84a52a"
npx -y swarm-verify@1.0.0 verify tampered --signer sha256:db270183c40c65843cacd2b3dcf20ee249d146d98c56699b2f3512ebeb84a52a 2>/dev/null | grep -E "^integrity|FAIL|^bundle" | cut -c1-118; echo "exit ${PIPESTATUS[0]}"
sleep 3
