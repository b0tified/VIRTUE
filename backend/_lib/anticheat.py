"""Suspicious-stats auto-flagging: pure evaluation of a player's recent aim stats."""
from typing import Any, Dict, List

DEFAULTS: Dict[str, float] = {
    "sample_matches": 10,   # look at this many most-recent matches
    "min_matches": 3,       # need at least this many before judging
    "hs_rate_max": 0.65,    # headshots / hits
    "hs_min_hits": 40,
    "accuracy_max": 0.75,   # hits / shots
    "acc_min_shots": 60,
    "kd_max": 8.0,          # kills / deaths
    "kd_min_kills": 40,
    "snap_rate_max": 0.30,  # instant-flick hits / hits
    "snap_min_hits": 40,
}
LIMITS = {
    "sample_matches": (3, 20), "min_matches": (1, 20),
    "hs_rate_max": (0.05, 1.0), "hs_min_hits": (1, 1000),
    "accuracy_max": (0.05, 1.0), "acc_min_shots": (1, 5000),
    "kd_max": (1.0, 100.0), "kd_min_kills": (1, 1000),
    "snap_rate_max": (0.05, 1.0), "snap_min_hits": (1, 1000),
}


def totals(matches: List[Dict[str, Any]]) -> Dict[str, Any]:
    t = {k: sum(int(m.get(k, 0) or 0) for m in matches) for k in ("kills", "deaths", "shots", "hits", "head_hits", "snap_hits")}
    t["matches"] = len(matches)
    t["accuracy"] = round(t["hits"] / t["shots"], 3) if t["shots"] else 0.0
    t["hs_rate"] = round(t["head_hits"] / t["hits"], 3) if t["hits"] else 0.0
    t["snap_rate"] = round(t["snap_hits"] / t["hits"], 3) if t["hits"] else 0.0
    t["kd"] = round(t["kills"] / max(1, t["deaths"]), 2)
    return t


def evaluate(matches: List[Dict[str, Any]], cfg: Dict[str, float]) -> Dict[str, Any]:
    """Return {"stats": totals, "reasons": [...]} — empty reasons means clean."""
    t = totals(matches)
    reasons: List[str] = []
    if t["matches"] < cfg["min_matches"]:
        return {"stats": t, "reasons": reasons}
    if t["hits"] >= cfg["hs_min_hits"] and t["hs_rate"] > cfg["hs_rate_max"]:
        reasons.append(f"Headshot rate {t['hs_rate'] * 100:.0f}% (limit {cfg['hs_rate_max'] * 100:.0f}%)")
    if t["shots"] >= cfg["acc_min_shots"] and t["accuracy"] > cfg["accuracy_max"]:
        reasons.append(f"Accuracy {t['accuracy'] * 100:.0f}% (limit {cfg['accuracy_max'] * 100:.0f}%)")
    if t["kills"] >= cfg["kd_min_kills"] and t["kd"] > cfg["kd_max"]:
        reasons.append(f"K/D {t['kd']:.1f} (limit {cfg['kd_max']:.1f})")
    if t["hits"] >= cfg["snap_min_hits"] and t["snap_rate"] > cfg["snap_rate_max"]:
        reasons.append(f"Instant snap hits {t['snap_rate'] * 100:.0f}% (limit {cfg['snap_rate_max'] * 100:.0f}%)")
    return {"stats": t, "reasons": reasons}


def clean_config(doc: Dict[str, Any]) -> Dict[str, float]:
    out = dict(DEFAULTS)
    for k, (lo, hi) in LIMITS.items():
        if k in doc:
            out[k] = max(lo, min(hi, float(doc[k])))
    return out
