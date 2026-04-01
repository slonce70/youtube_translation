import importlib


def test_supervisor_options_imports_with_current_runtime_dependencies() -> None:
    """Supervisor CLI helpers still depend on pkg_resources at import time."""
    module = importlib.import_module("supervisor.options")

    assert module is not None
