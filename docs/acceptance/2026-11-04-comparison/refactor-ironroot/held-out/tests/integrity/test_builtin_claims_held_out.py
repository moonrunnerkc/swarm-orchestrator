# Held out from the agent: the structural check for moving the built-in falsifiers out of
# ironroot.verification.falsification, written before either agent started.
from __future__ import annotations

import ast
import importlib
import inspect
from pathlib import Path

from ironroot.verification import falsification

MOVED_FUNCTIONS = (
    "_falsify_chain_seq_monotonic",
    "_falsify_parent_hash_linkage",
    "_falsify_artifact_hash_stability",
)
CLAIM_NAMES = ("chain_seq_monotonic", "parent_hash_linkage", "artifact_hash_stability")


def _defined_names(path: Path) -> set[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    names: set[str] = set()
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            names.add(node.name)
        elif isinstance(node, ast.Assign):
            names.update(t.id for t in node.targets if isinstance(t, ast.Name))
        elif isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
            names.add(node.target.id)
    return names


def test_new_module_defines_the_builtin_falsifiers_and_claims() -> None:
    builtin = importlib.import_module("ironroot.verification.builtin_claims")
    defined = _defined_names(Path(inspect.getfile(builtin)))
    for name in (*MOVED_FUNCTIONS, "_BUILTIN_CLAIMS"):
        assert name in defined, f"builtin_claims.py does not define {name}"


def test_falsification_no_longer_defines_them() -> None:
    defined = _defined_names(Path(inspect.getfile(falsification)))
    for name in (*MOVED_FUNCTIONS, "_BUILTIN_CLAIMS"):
        assert name not in defined, f"falsification.py still defines {name}"
    for kept in (
        "FalsificationEvidence",
        "FalsificationAttempt",
        "FalsifiableClaim",
        "FalsifiableClaimRegistry",
        "FalsificationReport",
        "get_claim_registry",
        "reset_claim_registry_for_testing",
        "run_falsification",
    ):
        assert kept in defined, f"falsification.py no longer defines {kept}"


def test_old_import_path_and_registry_are_unchanged() -> None:
    builtin = importlib.import_module("ironroot.verification.builtin_claims")
    assert falsification._BUILTIN_CLAIMS is builtin._BUILTIN_CLAIMS
    falsification.reset_claim_registry_for_testing()
    registry = falsification.get_claim_registry()
    assert registry.names() == CLAIM_NAMES
    for claim, function in zip(registry.all_claims(), MOVED_FUNCTIONS, strict=True):
        assert claim.falsifier is getattr(builtin, function)
        assert claim.falsifier.__module__ == "ironroot.verification.builtin_claims"
    falsification.reset_claim_registry_for_testing()
