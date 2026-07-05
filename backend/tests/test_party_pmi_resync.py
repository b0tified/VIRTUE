"""Party PMI (PARTY_MEMBER_INDEX) desync self-repair — verifies that
`_party_for_user` auto-heals a desynced index by scanning PARTIES for
a member match and repairing the index inline.

Real-world trigger: users reported the party panel flashing off in the
lobby (client polls /party/me → server returns {party_id: null} for a
tick, then the next poll returns the full payload again). The most
likely cause was an intermittent PMI miss (either from a very brief
window during accept/leave, or a stale entry after a party had swapped
leaders). The self-repair closes the loop by scanning PARTIES on cache
miss.
"""
import sys
import pathlib
import asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

import server  # noqa: E402


def _clear_state():
    server.PARTIES.clear()
    server.PARTY_MEMBER_INDEX.clear()
    server.PARTY_OWNERS.clear()


def test_party_for_user_returns_none_when_no_party():
    _clear_state()
    result = asyncio.get_event_loop().run_until_complete(
        server._party_for_user("user_never_in_party")
    )
    assert result is None


def test_party_for_user_returns_party_via_index():
    """Happy path — PMI has the entry, party exists, user is a member."""
    _clear_state()
    server.PARTIES["p1"] = {"leader_id": "u1", "members": ["u1", "u2"], "match_starting": False}
    server.PARTY_MEMBER_INDEX["u1"] = "p1"
    server.PARTY_MEMBER_INDEX["u2"] = "p1"
    result = asyncio.get_event_loop().run_until_complete(
        server._party_for_user("u2")
    )
    assert result is not None
    assert result["leader_id"] == "u1"


def test_party_for_user_self_repairs_missing_index():
    """DESYNC: user is in party["members"] but PMI has no entry. The
    helper must scan PARTIES, find the party, repair PMI, and return
    the party — otherwise the client's party panel would flash off."""
    _clear_state()
    server.PARTIES["p1"] = {"leader_id": "u1", "members": ["u1", "u2"], "match_starting": False}
    server.PARTY_MEMBER_INDEX["u1"] = "p1"
    # u2 is IN party["members"] but PMI is missing them.
    assert "u2" not in server.PARTY_MEMBER_INDEX
    result = asyncio.get_event_loop().run_until_complete(
        server._party_for_user("u2")
    )
    assert result is not None, "Self-repair failed — panel would flash off"
    # PMI must be repaired for future O(1) lookups.
    assert server.PARTY_MEMBER_INDEX.get("u2") == "p1"


def test_party_for_user_clears_stale_index_entry():
    """DESYNC in the other direction: PMI points to a party the user
    is NOT actually a member of (someone removed them but forgot to
    clean the index). Helper must clear the stale entry and return
    None."""
    _clear_state()
    server.PARTIES["p1"] = {"leader_id": "u1", "members": ["u1"], "match_starting": False}
    # u2 has a stale index pointing to p1 but isn't in members anymore.
    server.PARTY_MEMBER_INDEX["u2"] = "p1"
    result = asyncio.get_event_loop().run_until_complete(
        server._party_for_user("u2")
    )
    assert result is None
    # Stale entry must be scrubbed.
    assert "u2" not in server.PARTY_MEMBER_INDEX


def test_party_for_user_handles_party_id_referring_to_deleted_party():
    """PMI points to a party_id that no longer exists in PARTIES (party
    was disbanded but index wasn't cleaned). Must return None."""
    _clear_state()
    server.PARTY_MEMBER_INDEX["u1"] = "p_ghost"
    result = asyncio.get_event_loop().run_until_complete(
        server._party_for_user("u1")
    )
    assert result is None
