"""
Weather-risk + natural-hazard signal ingester.

- NWS active alerts (api.weather.gov, free, no key): severe/extreme alerts
  nationwide, kept as rows + severity counts. Weather is a market input too —
  energy demand, crops, logistics — so this feeds both verticals.
- USGS earthquakes (M4.5+, last day): global natural-hazard tape.
"""

import asyncio
import json

import httpx

import db

USER_AGENT = "Artha/1.0 (signal research; contact via repo)"
REFRESH_INTERVAL = 900

NWS_URL = "https://api.weather.gov/alerts/active"
USGS_URL = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson"

# Weighted so routine volume doesn't saturate: NWS runs 100–400 active alerts
# on an ordinary day, so Moderate barely counts and Extreme dominates.
SEVERITY_WEIGHT = {"Extreme": 5.0, "Severe": 1.0, "Moderate": 0.2, "Minor": 0.05}


async def poll_hazards() -> int:
    conn = db.get_conn()
    n = 0
    async with httpx.AsyncClient(timeout=20, headers={"User-Agent": USER_AGENT}) as client:
        try:
            r = await client.get(NWS_URL, params={"status": "actual", "severity": "Extreme,Severe,Moderate"})
            r.raise_for_status()
            feats = r.json().get("features", [])[:300]
            for f in feats:
                p = f.get("properties", {})
                conn.execute(
                    """INSERT OR REPLACE INTO hazard_events
                       (id, kind, severity, title, area, starts, ends, meta)
                       VALUES (?, 'alert', ?, ?, ?, ?, ?, ?)""",
                    (f.get("id"), p.get("severity"), p.get("event"),
                     (p.get("areaDesc") or "")[:300], p.get("onset"), p.get("ends"),
                     json.dumps({"headline": p.get("headline")})),
                )
                n += 1
        except Exception as e:
            print(f"[hazards] NWS failed: {e!r}")

        try:
            r = await client.get(USGS_URL)
            r.raise_for_status()
            for f in r.json().get("features", []):
                p = f.get("properties", {})
                mag = p.get("mag") or 0
                conn.execute(
                    """INSERT OR REPLACE INTO hazard_events
                       (id, kind, severity, title, area, starts, ends, meta)
                       VALUES (?, 'quake', ?, ?, ?, ?, NULL, ?)""",
                    (f"usgs:{f.get('id')}",
                     "Extreme" if mag >= 7 else "Severe" if mag >= 6 else "Moderate",
                     f"M{mag:.1f} earthquake", (p.get("place") or "")[:300],
                     None, json.dumps({"mag": mag, "tsunami": p.get("tsunami")})),
                )
                n += 1
        except Exception as e:
            print(f"[hazards] USGS failed: {e!r}")

    conn.execute("DELETE FROM hazard_events WHERE datetime(fetched_at) < datetime('now', '-3 days')")
    conn.commit()
    conn.close()
    print(f"[hazards] ingested/updated {n} events")
    return n


async def periodic_refresh():
    while True:
        await asyncio.sleep(REFRESH_INTERVAL)
        try:
            await poll_hazards()
        except Exception as e:
            print(f"[hazards] refresh failed: {e!r}")


def hazards_summary(conn) -> dict:
    rows = [dict(r) for r in conn.execute(
        """SELECT id, kind, severity, title, area, starts, ends, meta FROM hazard_events
           WHERE datetime(fetched_at) > datetime('now', '-6 hours')
           ORDER BY CASE severity WHEN 'Extreme' THEN 0 WHEN 'Severe' THEN 1 ELSE 2 END""",
    ).fetchall()]
    counts: dict[str, int] = {}
    risk = 0.0
    for r in rows:
        counts[r["severity"] or "Unknown"] = counts.get(r["severity"] or "Unknown", 0) + 1
        risk += SEVERITY_WEIGHT.get(r["severity"] or "", 0.1)
        try:
            r["meta"] = json.loads(r["meta"] or "{}")
        except json.JSONDecodeError:
            r["meta"] = {}
    # 0..1 squash: ~200 severity-weighted points saturates the gauge — a calm
    # day sits near 0.2, a genuine outbreak day pushes past 0.7
    risk_index = round(min(1.0, risk / 200.0), 3)
    return {"counts": counts, "risk_index": risk_index,
            "alerts": [r for r in rows if r["kind"] == "alert"][:20],
            "quakes": [r for r in rows if r["kind"] == "quake"][:10]}
