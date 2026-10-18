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
