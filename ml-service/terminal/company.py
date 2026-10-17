"""EE, ERN, EVTS, ANR, MGMT, SI, HDS and OWN: one Yahoo summary per
company, cut into the sections each screen shows. Every parser takes the
raw summary and returns plain numbers, or None when Yahoo has nothing."""

from datetime import datetime, timezone

from . import yahoo


def raw(x):
    """Yahoo wraps numbers as {"raw": 1.2, "fmt": "1.20"}; keep the number."""
    if isinstance(x, dict):
        return x.get("raw")
    return x


def day(epoch) -> str | None:
    v = raw(epoch)
    if v is None:
        return None
    if isinstance(v, str):
        return v[:10]
    return datetime.fromtimestamp(v, tz=timezone.utc).date().isoformat()


def pct(x) -> float | None:
    v = raw(x)
    return round(v * 100, 2) if isinstance(v, (int, float)) else None


PERIODS = {"0q": "This quarter", "+1q": "Next quarter", "0y": "This year", "+1y": "Next year"}


def estimates(qs: dict) -> list[dict] | None:
    out = []
    for t in (qs.get("earningsTrend") or {}).get("trend", []):
        if t.get("period") not in PERIODS:
            continue
        e, r = t.get("earningsEstimate") or {}, t.get("revenueEstimate") or {}
        trend, rev = t.get("epsTrend") or {}, t.get("epsRevisions") or {}
        out.append({
            "period": PERIODS[t["period"]], "end": t.get("endDate"),
            "eps_avg": raw(e.get("avg")), "eps_low": raw(e.get("low")), "eps_high": raw(e.get("high")),
            "eps_year_ago": raw(e.get("yearAgoEps")), "eps_growth_pct": pct(e.get("growth")),
            "analysts": raw(e.get("numberOfAnalysts")),
            "revenue_avg": raw(r.get("avg")), "revenue_growth_pct": pct(r.get("growth")),
            "eps_90_days_ago": raw(trend.get("90daysAgo")),
            "revisions_up_30d": raw(rev.get("upLast30days")), "revisions_down_30d": raw(rev.get("downLast30days")),
            # the consensus as it stood (EEG) and the latest revisions (EERM)
            "eps_trend": {k: raw(trend.get(k)) for k in ("90daysAgo", "60daysAgo", "30daysAgo", "7daysAgo", "current")},
            "revisions_up_7d": raw(rev.get("upLast7days")), "revisions_down_7d": raw(rev.get("downLast7Days") or rev.get("downLast7days")),
        })
    return out or None


def earnings(qs: dict) -> dict | None:
    history = [{
        "quarter_end": day(h.get("quarter")), "actual": raw(h.get("epsActual")),
        "estimate": raw(h.get("epsEstimate")), "surprise_pct": pct(h.get("surprisePercent")),
    } for h in (qs.get("earningsHistory") or {}).get("history", []) if raw(h.get("epsActual")) is not None]
    chart = (qs.get("earnings") or {}).get("financialsChart") or {}
    yearly = [{"year": y.get("date"), "revenue": raw(y.get("revenue")), "earnings": raw(y.get("earnings"))}
              for y in chart.get("yearly", [])]
    if not history and not yearly:
        return None
    return {"quarters": history, "years": yearly}


def events(qs: dict) -> dict | None:
    cal = qs.get("calendarEvents") or {}
    e = cal.get("earnings") or {}
    dates = [day(d) for d in e.get("earningsDate", [])]
    out = {
        "earnings_dates": [d for d in dates if d],
        "earnings_date_is_estimate": e.get("isEarningsDateEstimate"),
        "eps_expected": raw(e.get("earningsAverage")),
        "revenue_expected": raw(e.get("revenueAverage")),
        "ex_dividend": day(cal.get("exDividendDate")),
        "dividend_paid": day(cal.get("dividendDate")),
    }
    return out if any(v for v in out.values()) else None


def analysts(qs: dict) -> dict | None:
    fd = qs.get("financialData") or {}
    trend = [{"period": t.get("period"), **{k: t.get(k) for k in ("strongBuy", "buy", "hold", "sell", "strongSell")}}
             for t in (qs.get("recommendationTrend") or {}).get("trend", [])]
    changes = [{
        "date": day(h.get("epochGradeDate")), "firm": h.get("firm"),
        "from": h.get("fromGrade") or None, "to": h.get("toGrade") or None, "action": h.get("action"),
        "target": h.get("currentPriceTarget") or None, "prior_target": h.get("priorPriceTarget") or None,
    } for h in (qs.get("upgradeDowngradeHistory") or {}).get("history", [])[:25]]
    targets = {k: raw(fd.get(f"target{k.capitalize()}Price")) for k in ("low", "mean", "median", "high")}
    if not trend and not changes and not any(targets.values()):
        return None
    return {
        "targets": targets, "price": raw(fd.get("currentPrice")),
        "rating_mean": raw(fd.get("recommendationMean")), "rating": fd.get("recommendationKey"),
        "opinions": raw(fd.get("numberOfAnalystOpinions")), "trend": trend, "changes": changes,
    }


GOVERNANCE = ("auditRisk", "boardRisk", "compensationRisk", "shareHolderRightsRisk", "overallRisk")


def management(qs: dict) -> dict | None:
    ap = qs.get("assetProfile") or {}
    officers = [{"name": o.get("name"), "title": o.get("title"), "age": o.get("age"),
                 "pay": raw(o.get("totalPay")), "pay_year": o.get("fiscalYear")}
                for o in ap.get("companyOfficers", [])]
    governance = {k: ap.get(k) for k in GOVERNANCE if ap.get(k) is not None}
    if not officers and not governance:
        return None
    return {"officers": officers, "governance": governance,
            "employees": ap.get("fullTimeEmployees"), "website": ap.get("website")}


def short_interest(qs: dict) -> dict | None:
    ks = qs.get("defaultKeyStatistics") or {}
    now, before = raw(ks.get("sharesShort")), raw(ks.get("sharesShortPriorMonth"))
    if now is None:
        return None
    return {
        "shares_short": now, "prior_month": before,
        "change_pct": round((now / before - 1) * 100, 2) if before else None,
        "days_to_cover": raw(ks.get("shortRatio")),
        "pct_of_float": pct(ks.get("shortPercentOfFloat")),
        "pct_of_shares": pct(ks.get("sharesPercentSharesOut")),
        "as_of": day(ks.get("dateShortInterest")), "prior_as_of": day(ks.get("sharesShortPreviousMonthDate")),
        "float": raw(ks.get("floatShares")),
    }


def _owners(module: dict | None) -> list[dict]:
    return [{"holder": o.get("organization"), "pct": pct(o.get("pctHeld")), "shares": raw(o.get("position")),
             "value": raw(o.get("value")), "change_pct": pct(o.get("pctChange")), "as_of": day(o.get("reportDate"))}
            for o in (module or {}).get("ownershipList", [])]


def holders(qs: dict) -> dict | None:
    inst, funds = _owners(qs.get("institutionOwnership")), _owners(qs.get("fundOwnership"))
    return {"institutions": inst, "funds": funds} if inst or funds else None


def ownership(qs: dict) -> dict | None:
    mh = qs.get("majorHoldersBreakdown") or {}
    split = {"insiders_pct": pct(mh.get("insidersPercentHeld")),
             "institutions_pct": pct(mh.get("institutionsPercentHeld")),
             "institutions": raw(mh.get("institutionsCount"))}
    insiders = [{"name": h.get("name"), "role": h.get("relation"), "shares": raw(h.get("positionDirect")),
                 "last": h.get("transactionDescription"), "date": day(h.get("latestTransDate"))}
                for h in (qs.get("insiderHolders") or {}).get("holders", [])]
    trades = [{"date": day(t.get("startDate")), "name": t.get("filerName"), "role": t.get("filerRelation"),
               "text": t.get("transactionText") or None, "shares": raw(t.get("shares")), "value": raw(t.get("value"))}
              for t in (qs.get("insiderTransactions") or {}).get("transactions", [])[:25]]
    nspa = qs.get("netSharePurchaseActivity") or {}
    six_months = {"buys": raw(nspa.get("buyInfoCount")), "sells": raw(nspa.get("sellInfoCount")),
                  "net_shares": raw(nspa.get("netInfoShares"))} if nspa else None
    if not insiders and not trades and not any(split.values()):
        return None
    return {"split": split, "insiders": insiders, "trades": trades, "insider_six_months": six_months}


SECTIONS = {
    "estimates": estimates, "earnings": earnings, "events": events, "analysts": analysts,
    "management": management, "short_interest": short_interest, "holders": holders, "ownership": ownership,
}


def cut(qs: dict) -> dict:
    """Every section, each None when Yahoo has nothing for it."""
    price = qs.get("price") or {}
    return {"name": price.get("longName") or price.get("shortName"),
            "currency": price.get("currency"),
            **{name: parse(qs) for name, parse in SECTIONS.items()}}


async def company(symbol: str) -> dict:
    return cut(await yahoo.summary(symbol))
