# Systemd Unit Hardening — Reference

This document explains every non-default security directive added to the
example units under `docs/systemd/`. It is the reference operators should
consult before relaxing any knob.

## Why the extra directives

The defaults are sufficient to run the service correctly, but not safely
enough for a machine that may also host other workloads. The goal is to
make a stream worker (and the backend API) a **badly-behaving tenant**:
unable to read other users' data, unable to touch the kernel, unable to
spawn containers, unable to write executable memory, and unable to make
system calls outside a narrow whitelist. Kernel-level defense-in-depth.

The baseline profile follows the [systemd service hardening
checklist](https://www.freedesktop.org/software/systemd/man/systemd.exec.html)
and the [`systemd-analyze security`](https://www.freedesktop.org/software/systemd/man/systemd-analyze.html)
scoring model; the goal is to drive exposure level to **safe** or
**hardly exposed** (score ≥ 8) without breaking the workload.

## Directive reference

| Directive | Purpose | Loosen if… |
|---|---|---|
| `NoNewPrivileges=true` | Child processes cannot gain setuid/setgid privileges | Never — required for most filters below |
| `CapabilityBoundingSet=` | Empty bounding set = no Linux capabilities | Need `CAP_NET_BIND_SERVICE` (we don't; port 8000 is unprivileged) |
| `AmbientCapabilities=` | No caps inherited by children | Same as above |
| `UMask=0077` | Files created are owner-only by default | Files must be group-readable — but then group them via shared dir, don't widen umask |
| `ProtectSystem=strict` | `/`, `/usr`, `/boot`, `/efi` read-only; `/etc` read-only | Adding a writable path — use `ReadWritePaths=` instead |
| `ProtectHome=yes` | Hides `/home`, `/root`, `/run/user` | Accessing a user home — shouldn't happen for a daemon |
| `PrivateTmp=true` | Private `/tmp` and `/var/tmp` | Sharing temp files with another service — use a dedicated `ReadWritePaths` dir |
| `ReadWritePaths=` | Whitelist of directories writable under ProtectSystem=strict | Relocating streams/uploads — update list to match |
| `ProtectKernelTunables=yes` | `/proc/sys`, `/sys` read-only | Need to tune sysctl from the service — don't; configure via `sysctl.d/` |
| `ProtectKernelModules=yes` | `modprobe` blocked | Loading a kernel module — out of scope for an app service |
| `ProtectKernelLogs=yes` | `/proc/kmsg`, `/dev/kmsg`, `kern.log` hidden | Need to read kernel ring buffer — use journalctl instead |
| `ProtectControlGroups=yes` | `/sys/fs/cgroup` read-only | Writing cgroup knobs from app — use service's own resource directives |
| `ProtectProc=invisible` | Hides other users' processes in `/proc` | Service legitimately needs to enumerate siblings — unusual |
| `ProcSubset=pid` | Masks non-process files under `/proc` | Need `/proc/cpuinfo` or similar — set `ProcSubset=all` |
| `RestrictNamespaces=yes` | Service cannot `unshare` new namespaces | Need rootless containers — out of scope |
| `RestrictRealtime=yes` | No `SCHED_FIFO`, `SCHED_RR`, `SCHED_DEADLINE` | Audio/video real-time scheduling — ffmpeg does not require it |
| `RestrictSUIDSGID=yes` | Cannot create setuid/setgid files | Never — required for trustworthy user-writable dirs |
| `LockPersonality=yes` | `personality(2)` locked to the boot default | Need x86-on-x86-64 emulation — unusual |
| `MemoryDenyWriteExecute=yes` | No `mmap(PROT_WRITE|PROT_EXEC)` pages | JIT in dependencies — CFFI sometimes needs this; drop to `no` if ImportErrors appear |
| `DevicePolicy=closed` | Only minimal `/dev` entries (null/zero/random/tty) | Need `/dev/dri/renderD128` for HW accel — add explicit `DeviceAllow=` |
| `KeyringMode=private` | Private kernel keyring per service | Rarely relevant — leave strict |
| `RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6` | TCP/UDP/v6 + unix sockets only | Using raw sockets / bluetooth / netlink — none of our flows do |
| `SystemCallArchitectures=native` | Block non-native syscalls (e.g. i386 on amd64) | Running multiarch binaries — we don't |
| `SystemCallFilter=@system-service` | Broad app-server profile | Filter rejects a legitimate call — add specific `SystemCallFilter=name` |
| `SystemCallFilter=~@privileged @resources …` | Deny-list of capability-adjacent syscalls | HW accel ioctls hit `@privileged` — drop that category specifically |
| `CPUQuota` / `MemoryMax` / `TasksMax` | Resource ceilings per unit | Measured workload exceeds ceiling — raise after profiling, not guesswork |
| `Slice=streaming.slice` | Group all stream units into a single cgroup slice | Need separate accounting — use a different slice |

## Verification

After installing a unit, confirm the hardening takes effect:

```bash
sudo systemd-analyze security youtube-backend.service
sudo systemd-analyze security ffmpeg@.service
```

Target exposure level: **≤ 3 (safe)** or **≤ 5 (medium)**. Anything worse
suggests a directive didn't apply (typos, conflicts with a distro-level
drop-in, wrong path under `ReadWritePaths=`).

To check the effective filesystem view from inside the service:

```bash
sudo systemctl stop ffmpeg@<stream_id>.service
sudo systemd-run --uid=streambot --gid=streambot \
    --property="$(grep -E '^(Protect|Private|ReadWritePaths|UMask)' /etc/systemd/system/ffmpeg@.service | xargs -n1)" \
    --pty /bin/bash
```

## Known incompatibilities

- **Host-side ffmpeg with VAAPI / NVENC** — needs `DeviceAllow=` for
  `/dev/dri/renderD*` or `/dev/nvidia*`; may require dropping
  `SystemCallFilter=~@privileged` because some ioctls are gated.
- **CFFI with JIT (e.g. `cryptography` on alpine)** — conflicts with
  `MemoryDenyWriteExecute=yes`; drop on hosts where you see `SIGSEGV`
  on first crypto call.
- **`DATABASE_URL` pointing to a unix socket under `/var/run/postgresql`** —
  ProtectSystem=strict leaves `/var` read-write, so the socket works.
  But if your pg socket lives under `/tmp`, add it to `ReadWritePaths=`.

## When to revisit

Revisit this file whenever:
- A dependency upgrade changes syscall or mmap behaviour (watch for JIT).
- You relocate `STREAM_DIR` or `UPLOAD_DIR`.
- You add hardware acceleration.
- You see `Permission denied` in the unit's journal that cannot be
  explained by application-level config.

Each relaxation should be justified in the unit file comment next to the
directive that was changed.
