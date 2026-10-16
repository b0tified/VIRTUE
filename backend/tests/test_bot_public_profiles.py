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
