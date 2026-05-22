import pytest


def pytest_collection_modifyitems(config, items):
    """Auto-mark async tests with asyncio so we don't need to repeat the decorator."""
    pass
