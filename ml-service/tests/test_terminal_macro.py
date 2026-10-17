"""Macro: BIS rates, the last policy move, OECD phases, Damodaran's table."""

from terminal import macro


def test_last_change_finds_the_latest_move():
    pts = [{"date": "2026-01-01", "value": 4.5}, {"date": "2026-03-19", "value": 4.25}, {"date": "2026-03-20", "value": 4.25},
           {"date": "2026-10-01", "value": 4.25}]
    assert macro.last_change(pts) == {"rate": 4.25, "as_of": "2026-10-01", "changed": "2026-03-19", "change_bp": -25}
    assert macro.last_change([{"date": "d", "value": 1.0}])["changed"] is None


def test_bis_csv():
    text = "FREQ,REF_AREA,TIME_PERIOD,OBS_VALUE\nD,GB,2026-10-09,3.75\nD,US,2026-10-09,\n"
    assert macro.parse_bis(text) == [{"area": "GB", "date": "2026-10-09", "value": 3.75}]


def test_cli_phases():
    rising_above = [{"t": f"2026-0{i}", "v": v} for i, v in enumerate([100.1, 100.2, 100.3, 100.5], 1)]
    falling_below = [{"t": f"2026-0{i}", "v": v} for i, v in enumerate([99.9, 99.8, 99.6, 99.5], 1)]
    assert macro.cli_reading(rising_above)["phase"] == "expansion"
    assert macro.cli_reading(falling_below)["phase"] == "slowdown"
    assert macro.cli_reading([{"t": "x", "v": 99.0}] * 3 + [{"t": "y", "v": 99.5}])["phase"] == "recovery"
