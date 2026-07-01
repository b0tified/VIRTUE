"""Avatar equip range tests.

Regression: the frontend exposes 22 avatar slots (idx 0-21) but the
backend used to cap `AvatarIn.avatar` at `le=11`, so any pick of the
2026-06-29 expansion avatars (idx 12-21) returned a 422 validation
error. The client alert()ed the FastAPI error array as
"[object Object]" — reported by the user 2026-07-01.

This file guards:
  • Every 0..21 index is accepted by the endpoint.
  • Ungated indices (12..21) don't need level/tier checks.
  • Out-of-range (22, -1) still return 422 (regression alarm if
    someone bumps the cap without expanding the frontend list).
"""
import sys
import pathlib
import pytest
from bson import ObjectId

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import server  # noqa: E402


def test_avatar_field_accepts_full_expanded_range():
    """Direct Pydantic validation — every idx in the current avatar
    pool (0..21) must validate."""
    for i in range(0, 22):
        v = server.AvatarIn(avatar=i)
        assert v.avatar == i


def test_avatar_field_rejects_out_of_range():
    """Bumping without a corresponding frontend expansion should trip
    this — sentinel for future avatar-count changes."""
    with pytest.raises(Exception):
        server.AvatarIn(avatar=22)
    with pytest.raises(Exception):
        server.AvatarIn(avatar=-1)


@pytest.mark.asyncio
async def test_set_avatar_accepts_ungated_expansion_indices():
    """The 12-21 slots are ungated (no level/tier requirement) — the
    endpoint should equip them without a 403 even for a level-1 user.
    Also verifies (in the same async test to avoid motor's cross-loop
    quirks) that the original 6-11 gates are still enforced by calling
    set_avatar directly with a fresh in-memory doc — no DB needed."""
    if server.db is None:
        pytest.skip("No mongo")
    marker = "avatarexpansion"
    doc = {
        "_id": ObjectId(),
        "email": "av@t.test",
        "username": "av_user",
        "password_hash": "x",
        "stats": {"kills": 0, "deaths": 0, "matches": 0, "wins": 0},
        "avatar": 0,
        "_test_marker": marker,
    }
    await server.db.users.insert_one(doc)
    try:
        # 1) ungated indices — should succeed
        for i in (12, 15, 18, 21):
            out = await server.set_avatar(server.AvatarIn(avatar=i), user=doc)
            assert out.get("avatar") == i, f"idx {i}: got {out.get('avatar')}"
        # 2) locked animated special (idx 11 — Level 30 or Goonmaster)
        #    must still 403 for our level-1 test user.
        try:
            await server.set_avatar(server.AvatarIn(avatar=11), user=doc)
            raise AssertionError("expected 403 for locked avatar 11")
        except server.HTTPException as e:
            assert e.status_code == 403
            assert "unlocks at Level" in str(e.detail)
    finally:
        await server.db.users.delete_many({"_test_marker": marker})
