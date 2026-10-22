import hashlib
import json
from pathlib import Path
import subprocess
import tarfile
import tempfile

root = Path(__file__).resolve().parent / "docs/evidence/2026-10-22-capability"
inventory = json.loads((root / "inventory.json").read_text())
archive = root / "evidence.tar.gz"
assert len(archive.read_bytes()) == inventory["archiveBytes"]
assert "sha256:" + hashlib.sha256(archive.read_bytes()).hexdigest() == inventory["archiveDigest"]
expected = {row["path"]: row for row in inventory["files"]}
assert len(expected) == len(inventory["files"])
with tempfile.TemporaryDirectory(prefix="swarm-capability-verify-") as scratch:
    destination = Path(scratch)
    with tarfile.open(archive) as packed:
        members = packed.getmembers()
        assert len(members) == len(expected)
        assert {member.name for member in members} == set(expected)
        for member in members:
            assert member.isfile()
            assert not member.name.startswith("/")
            assert all(part not in ("", ".", "..") for part in member.name.split("/"))
        packed.extractall(destination, filter="data")
    for path in destination.rglob("*"):
        path.chmod(0o700 if path.is_dir() else 0o600)
    for name, row in expected.items():
        data = (destination / name).read_bytes()
        assert len(data) == row["bytes"]
        assert "sha256:" + hashlib.sha256(data).hexdigest() == row["digest"]
    bundles = sorted((destination / "native-sessions").glob("*/bundle"))
    assert len(bundles) == 5
    for bundle in bundles:
        subprocess.run(["node", "verify.mjs"], cwd=bundle, check=True)
print(f"Verified {len(expected)} exact files and 5 native bundles; task correctness is separate.")
