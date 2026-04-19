from pathlib import Path


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def test_readme_referenced_core_docs_exist() -> None:
    root = _repo_root()
    readme = (root / "README.md").read_text(encoding="utf-8")
    required_docs = [
        "docs/MVP_COMPLETE.md",
        "docs/IMPLEMENTATION_REPORT.md",
        "docs/TROUBLESHOOTING.md",
        "docs/backend_api_contract.md",
    ]

    for relative_path in required_docs:
        assert relative_path in readme
        assert (root / relative_path).exists(), f"README references missing doc: {relative_path}"
