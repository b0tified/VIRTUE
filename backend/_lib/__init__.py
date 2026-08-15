"""Backend internal helper packages.

Pure-logic modules extracted from server.py during the 2026-02-24
maintainability refactor. Anything in `_lib/` MUST be:
  - Free of `db` (Mongo) access — pure Python.
  - Free of FastAPI request/response objects.
  - Safe to import from either server.py or a pytest without side
    effects (no global connections opened at import time).

server.py re-exports every symbol back into its own namespace so
existing tests (`server.RANK_TIERS`, `server.hash_password`, etc.)
keep working unchanged.
"""
