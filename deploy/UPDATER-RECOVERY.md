# Gateway update recovery

The previous updater installed a newer core but left required state migrations
pending. Its readiness failure then triggered a binary-only rollback, leaving an
older core unable to open the newer configuration and SQLite state.

`openclaw-auto-update` now applies the supported non-interactive migrations before
starting the gateway, waits up to three minutes for readiness, rejects an older
registry version, and leaves a failed update stopped for repair instead of
downgrading its core. It still backs up the configuration before an update. A
manual recovery must back up the full state before applying further changes;
the updater's configuration backup alone is not a complete state rollback.

Root package installation uses `/var/cache/openclaw/npm-core`. Plugin maintenance
runs as `openclaw` with `/home/openclaw/.npm`, avoiding root-owned entries in the user's
cache. Both maintenance and the gateway use `/var/tmp/openclaw` for build scratch.
On this server `/tmp` is RAM-backed; retained plugin build trees had exhausted the
container's memory allowance.

Install the script as root at `/usr/local/sbin/openclaw-auto-update`, mode 0755.
Create `/var/tmp/openclaw` owned by `openclaw:openclaw`, mode 0700. Install the supplied
`openclaw-gateway.service.d/temporary-storage.conf` under
`/etc/systemd/system/openclaw-gateway.service.d/` and run `systemctl daemon-reload`.
Preserve the existing gateway unit, authentication, firewall and proxy settings.

Validation on 21 September 2026: `bash -n` passed, and running the updater with
the installed and registry versions both at 2026.9.5 exited successfully without
restarting the gateway. A future package upgrade was not simulated.
