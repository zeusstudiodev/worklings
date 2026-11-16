---
title: Python
department: engineering
stacks: [python]
paths:
  - "**/*.py"
  - "src/**/*.py"
  - "tests/**/*.py"
  - "scripts/**/*.py"
  - "pyproject.toml"
---
- Target the Python version in `pyproject.toml` (`requires-python`) and use only features it supports.
- Use the project's dependency tool (uv, Poetry, pip-tools, Hatch); keep the lockfile in sync and never install globally.
- Type-hint public functions and run the project's type checker; new code adds no new errors.
- Format and lint with the project's configured tools (often Ruff); don't reformat code you didn't change.
- Validate data at the edges (Pydantic, dataclasses or attrs, as the project does); pass typed objects inside, not loose dicts.
- Catch specific exceptions; no bare `except:` and no `except Exception: pass`; chain with `raise ... from err`.
- Use `pathlib` and context managers for files, locks and connections; open text files with `encoding="utf-8"`.
- No mutable default arguments, no work at import time; guard scripts with `if __name__ == "__main__":`.
- Library and service code logs through module-level `logging` loggers, not `print`, with values as arguments, not f-strings.
- Run `subprocess` with an argument list and `check=True`; never `shell=True` with anything derived from input.
- Never `eval`, `exec` or unpickle untrusted data; load YAML with `yaml.safe_load`.
- Use timezone-aware datetimes (`datetime.now(timezone.utc)`); store and compare in UTC.
- In async code, never call blocking I/O; use async clients and `asyncio.TaskGroup` (3.11+) or `gather` for concurrency.
- Money and exact quantities use `Decimal` or integer minor units, never floats.
- Tests use pytest with fixtures, `parametrize` and `tmp_path`; no real network in unit tests.
- Prefer the standard library; add a dependency only for a clear reason, through the project's tool.
