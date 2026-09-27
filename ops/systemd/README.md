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

## Not yet installed

`artha-pit-ingest.timer` (in this directory) + a matching oneshot service
(`ExecStart=/usr/bin/curl -sf -m 3500 -X POST http://localhost:8421/pit/ingest`,
`TimeoutStartSec=3600`, `After=news-bias-ml.service`) would run the nightly
PIT ingest at 02:30. Install both to `~/.config/systemd/user/`, then:
`systemctl --user daemon-reload && systemctl --user enable --now artha-pit-ingest.timer`.
