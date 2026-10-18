from _lib.ranks import compute_placement_delta as f


def test_second_place_always_gains_small_amount():
    assert f(kills=0, deaths=15, placement=2, cur_tier_idx=3) == 10
    assert 10 <= f(kills=5, deaths=5, placement=2, cur_tier_idx=3) <= 40
    assert f(kills=40, deaths=0, placement=2, cur_tier_idx=7) == 40


def test_first_and_third_unchanged():
    assert f(kills=10, deaths=2, placement=1, cur_tier_idx=3) > 100
    assert f(kills=3, deaths=8, placement=3, cur_tier_idx=3) < 0
