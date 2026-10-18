"""Text similarity on documents whose answer is known by hand."""

import math
from collections import Counter

import reports


def test_words_drop_markup_numbers_and_exhibits():
    raw = "<DOCUMENT><TYPE>10-K<p>Risk &amp; Risk: 2023 sales fell</p></DOCUMENT><DOCUMENT>exhibit text"
    assert reports.words(raw) == Counter({"risk": 2, "sales": 1, "fell": 1})


def test_cosine_and_jaccard():
    a, b = Counter({"risk": 2, "sales": 1}), Counter({"risk": 2, "sales": 1})
    assert math.isclose(reports.cosine(a, b), 1.0) and reports.jaccard(a, b) == 1.0
    c = Counter({"lawsuit": 3})
    assert reports.cosine(a, c) == 0.0 and reports.jaccard(a, c) == 0.0
    d = Counter({"risk": 1, "lawsuit": 1})
    assert math.isclose(reports.cosine(a, d), 2 / (math.sqrt(5) * math.sqrt(2)))
    assert math.isclose(reports.jaccard(a, d), 1 / 3)


def test_content_measures_ignore_function_words():
    a = Counter({"the": 100, "of": 80, "revenue": 4, "growth": 2})
    b = Counter({"the": 120, "of": 60, "lawsuit": 4, "impairment": 2})
    assert reports.cosine(a, b) > 0.9                     # function words make them look alike
    assert reports.cosine(reports.content(a), reports.content(b)) == 0.0
    assert reports.new_share(b, a) == 1.0
    assert reports.new_share(a, a) == 0.0
