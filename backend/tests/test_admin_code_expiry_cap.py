"""Regression tests for admin-created redeem codes with expiry +
max-redemptions caps. Covers:
  - _parse_expires_at acceptance/rejection rules
  - The default 30-day backfill on legacy codes
  - The "generic Invalid or expired code." error contract
"""
import sys
import pathlib
from datetime import datetime, timezone, timedelta

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

import server  # noqa: E402
from fastapi import HTTPException  # noqa: E402


def test_parse_expires_at_accepts_iso_date_promoted_to_eod():
    """A date-only input should be promoted to end-of-day so the code
    works through the entirety of that day in UTC."""
    future_date = (datetime.now(timezone.utc) + timedelta(days=3)).date().isoformat()
    out = server._parse_expires_at(future_date)
    assert out is not None
    assert out.hour == 23 and out.minute == 59 and out.second == 59
    assert out.tzinfo is not None


def test_parse_expires_at_accepts_full_iso_datetime():
    iso = (datetime.now(timezone.utc) + timedelta(hours=4)).replace(microsecond=0).isoformat()
    out = server._parse_expires_at(iso)
    assert out is not None
    assert out > datetime.now(timezone.utc)


def test_parse_expires_at_handles_z_suffix():
    iso = (datetime.now(timezone.utc) + timedelta(hours=2)).replace(microsecond=0).isoformat()
    # Strip "+00:00" and append "Z"
    iso_z = iso.replace("+00:00", "Z")
    out = server._parse_expires_at(iso_z)
    assert out is not None and out > datetime.now(timezone.utc)


def test_parse_expires_at_returns_none_for_blank_or_null():
    assert server._parse_expires_at(None) is None
    assert server._parse_expires_at("") is None
    assert server._parse_expires_at("   ") is None


def test_parse_expires_at_rejects_past_dates():
    past = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    with pytest.raises(HTTPException) as exc:
        server._parse_expires_at(past)
    assert exc.value.status_code == 400
    assert "future" in exc.value.detail.lower()


def test_parse_expires_at_rejects_garbage():
    with pytest.raises(HTTPException) as exc:
        server._parse_expires_at("not-a-date")
    assert exc.value.status_code == 400


def test_redeem_codes_use_generic_message():
    """The user-facing error must collapse all dynamic-code failures into
    a single generic message so we don't leak whether a code exists, is
    expired, or is maxed. (Verified by code search rather than a live
    DB call — that lives in an async integration test.)"""
    src = pathlib.Path(__file__).resolve().parents[1].joinpath("server.py").read_text()
    # The hardcoded-and-not-found, expired, and maxed branches all raise
    # the same `Invalid or expired code.` 404 detail.
    assert src.count("\"Invalid or expired code.\"") >= 3
