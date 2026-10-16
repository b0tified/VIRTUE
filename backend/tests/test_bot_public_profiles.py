from datetime import datetime, timezone, timedelta
import server as srv


def test_history_is_stable_and_rolls_forward():
    now = datetime(2026, 6, 1, 12, tzinfo=timezone.utc)
    a = srv._synth_bot_history("FlareStorm", 1500, 3, now)
    b = srv._synth_bot_history("FlareStorm", 1500, 3, now)
    assert a == b and len(a) == 10
    later = srv._synth_bot_history("FlareStorm", 1500, 3, now + timedelta(hours=30))
    assert later[0]["ended_at"] > a[0]["ended_at"]
    assert all(datetime.fromisoformat(m["ended_at"]) <= now for m in a)
    assert [m["ended_at"] for m in a] == sorted([m["ended_at"] for m in a], reverse=True)


def test_roughly_half_of_bots_public():
    names = [f"Bot{i}" for i in range(400)]
    share = sum(srv._bot_profile_public(n) for n in names) / len(names)
    assert 0.35 < share < 0.65
    assert srv._bot_profile_public("FlareStorm") == srv._bot_profile_public("flarestorm")


def test_activity_matches_history():
    now = datetime(2026, 6, 1, 12, tzinfo=timezone.utc)
    name = "FlareStorm"
    hist = srv._synth_bot_history(name, 1500, 3, now + timedelta(days=2))
    # Right before a recorded match ends the bot is in that match's mode.
    m = hist[0]
    end = datetime.fromisoformat(m["ended_at"])
    act = srv.bot_activity(name, 3, end - timedelta(seconds=30))
    assert act["in_match"] and act["match_kind"] == m["mode"]
    assert srv.bot_activity(name, 3, end + timedelta(minutes=10)) == {"online": True, "in_match": False, "match_kind": None}
    share = sum(srv.bot_activity(f"B{i}", 2, now)["online"] for i in range(400)) / 400
    assert 0.15 < share < 0.6
