import finlex


def test_lm_polarity_signs():
    pos = finlex.lm_scores("record profit growth, strong rally and recovery")
    neg = finlex.lm_scores("bankruptcy fears trigger selloff, losses deepen the crisis")
    assert pos["polarity"] > 0
    assert neg["polarity"] < 0
    assert pos["hits"] > 0 and neg["hits"] > 0


def test_lm_uncertainty_and_empty():
    unc = finlex.lm_scores("results may possibly fluctuate, outlook uncertain and unclear")
    assert unc["uncertainty"] > 0
    empty = finlex.lm_scores("")
    assert empty == {"polarity": 0.0, "uncertainty": 0.0, "hits": 0}


def test_social_score_direction():
    assert finlex.social_score("bullish calls printing, to the moon") > 0
    assert finlex.social_score("bearish dump, bagholders getting rekt") < 0
    assert finlex.social_score("the meeting is on tuesday") == 0.0


def test_social_negation_flips():
    plain = finlex.social_score("bullish")
    negated = finlex.social_score("not bullish")
    assert plain > 0
    assert negated < 0


def test_social_emphasis_amplifies_and_clamps():
    calm = finlex.social_score("bullish breakout")
    loud = finlex.social_score("BULLISH BREAKOUT!!!")
    assert loud >= calm
    assert -1.0 <= loud <= 1.0


def test_disagreement():
    assert finlex.disagreement([]) == 0.0
    assert finlex.disagreement([0.5]) == 0.0
    assert finlex.disagreement([0.5, 0.5, 0.5]) == 0.0
    assert finlex.disagreement([1.0, -1.0, 1.0, -1.0]) > 0.9
