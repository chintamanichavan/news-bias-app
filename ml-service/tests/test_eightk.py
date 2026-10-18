import eightk


def test_rows_keep_only_8k_with_items():
    block = {"form": ["8-K", "10-Q", "8-K/A", "8-K"], "filingDate": ["2020-01-02", "2020-02-01", "2020-03-01", "2020-04-01"],
             "items": ["4.02,9.01", "", "4.02", "5.02"]}
    assert eightk._rows(block, 7) == [(7, "2020-01-02", "4.02,9.01"), (7, "2020-04-01", "5.02")]
