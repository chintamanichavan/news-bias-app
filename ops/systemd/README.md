# Service management

Artha already runs under **user systemd units** that predate this directory,
installed at `~/.config/systemd/user/` (that is the source of truth, not this
folder):

- `news-bias-ml.service` — uvicorn on :8421, `Restart=always`. This is why a
  manually killed ML service "comes back": systemd respawns it in seconds.
  Never start a second copy with `nohup`; use
  `systemctl --user restart news-bias-ml`.
- `news-bias-web.service` — **production** Next.js on :4321. `ExecStartPre`
  runs `pnpm build`, so a restart always serves the current working tree
  (never restart it while a dev server is mid-build — concurrent builds
  corrupt `.next`).

The dev server (`pnpm dev -p 3002`) is *not* unit-managed. Tailscale routing:
the root `https://kaunteya.tail78af30.ts.net` proxies to :3002 (dev), and
:8445 proxies to :4321 (production).

## Installed: the nightly ingest

`artha-pit-ingest.service` + `artha-pit-ingest.timer` run `ml-service/pit_ingest.py`
every night at 02:30: prices, EDGAR filings, FRED and GDELT into the PIT store.
It runs as its own process rather than through `POST /pit/ingest`, so a long
ingest never ties up the ML service. Installed as copies:

    cp ops/systemd/artha-pit-ingest.* ~/.config/systemd/user/
    systemctl --user daemon-reload && systemctl --user enable --now artha-pit-ingest.timer

## Installed: the live record

`artha-tracker.service` + `artha-tracker.timer` run `ml-service/tracker.py` on
the 1st of each month at 07:00: refresh every S&P 500 member's price history,
then write that month's rule lists to `ml-service/record/` and commit that one
file (anything else staged is left alone). Nothing is pushed.
A snapshot is never rewritten. Installed as copies:

    cp ops/systemd/artha-tracker.* ~/.config/systemd/user/
    systemctl --user daemon-reload && systemctl --user enable --now artha-tracker.timer

## Installed: the options record

`artha-options.service` + `artha-options.timer` run `ml-service/options.py`
every Friday at 13:30, while the market is open: two expiries and five call
strikes for every S&P 500 member, saved to `ml-service/record/options/` and
committed (see the module's pre-registered test). `Persistent=false`: a
missed Friday is skipped rather than run on stale weekend quotes. Installed
as copies:

    cp ops/systemd/artha-options.* ~/.config/systemd/user/
    systemctl --user daemon-reload && systemctl --user enable --now artha-options.timer

## Installed: the small-cap screen

`artha-smallcaps.service` + `artha-smallcaps.timer` run `ml-service/smallcaps.py`
on the 3rd of each month at 05:00: download SEC's bulk submissions and
companyfacts files and the latest form indexes (about 3 GB), read any new
10-Ks, fetch the latest FINRA short-interest settlement, then write that
month's list to `ml-service/record/screen/` and commit it. Installed as copies:

    cp ops/systemd/artha-smallcaps.* ~/.config/systemd/user/
    systemctl --user daemon-reload && systemctl --user enable --now artha-smallcaps.timer
