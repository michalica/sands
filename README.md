# Sands

Secure, fast runtime for executing untrusted JavaScript (and soon: shell commands, Python, browsers) inside Firecracker microVMs. Designed for AI agents, code interpreters, and copilots that need to run model- or user-generated code safely in milliseconds.

> "Run user or AI-generated code safely in milliseconds — without worrying about security."

A self-hostable alternative to [e2b](https://e2b.dev/).

---

## Highlights

- **Strong isolation** — Firecracker microVMs + jailer, no shared filesystem, per-sandbox cgroup CPU + memory caps.
- **Fast boot** — per-template Firecracker snapshots; cold start ~1.3s (down from ~8s without snapshots), <10ms target with CoW reflinks.
- **Simple HTTP API** — Fastify server with `POST /sandboxes`, `POST /sandboxes/:id/execute`, `GET /metrics`, WebSocket `/events`, etc.
- **Auth + dashboard** — Better-Auth (Bearer API keys) + Next.js dashboard for signup, sandbox list, API key management.
- **One-command deploy** — `terraform apply` + `make deploy` brings up API, dashboard, and the Firecracker host on GCP.

## Repository layout

```
.
├── src/                       Fastify API + sandbox manager + worker daemon
│   ├── server.ts              Public API entrypoint
│   ├── sandbox/               Backends: firecracker-backend.ts, process-backend.ts
│   ├── control-plane/         Worker cluster + scheduler (Tier 4.2)
│   ├── worker/                Internal worker HTTP daemon
│   ├── routes/                HTTP route handlers (sandboxes, files, …)
│   └── auth.ts                Better-Auth setup
├── dashboard/                 Next.js dashboard (signup, API keys, sandbox list)
├── mcp-server/                First-party MCP server exposing sandbox ops as MCP tools
├── infra/
│   ├── firecracker/           Kernel + rootfs build, guest-agent, snapshot tooling
│   │   └── guest-agent/       In-guest Node agent (vsock RPC)
│   ├── terraform/gcp/         GCP deploy (VMs, networking, startup scripts)
│   └── deploy/                Deploy scripts run on the host
├── scripts/                   Helper scripts: create, execute, destroy, stress, smoke
├── tests/                     Vitest test suite
└── prd.md                     Product Requirements Document (source of truth)
```

## Quick start (local dev)

Requires Node 22+. Firecracker only runs on Linux with KVM; on macOS the API uses the `process` backend for local development.

```bash
npm install
npm run build

# API on :3000
npm run dev

# (optional) worker daemon for the control-plane split
npm run dev:worker
```

Then create a sandbox:

```bash
# create + run via helper scripts
scripts/create.sh
scripts/execute.sh <sandbox-id> 'console.log(2 + 2)'
scripts/destroy.sh <sandbox-id>
```

## Deploy on GCP

The reference deploy is a single `n2-standard-2` in `europe-west3` with nested virtualization enabled.

```bash
cd infra/terraform/gcp
cp terraform.tfvars.example terraform.tfvars   # fill in project, zone, …
terraform init
terraform apply
make deploy   # builds rootfs + snapshots, pushes the API + dashboard
```

Outputs include the public IP of the API VM and the dashboard URL. The host runs:

- Fastify API on `:3000`
- Next.js dashboard on `:3001`
- Caddy (planned in v2) for TLS + port forwarding
- Firecracker microVMs under jailer (`/srv/jailer/…`)

## Architecture (current)

```
GCP n2-standard-2 (nested-virt)
├── Dashboard (Next.js, :3001) ──┐
│                                 ├── SQLite (users, sandboxes, API keys)
├── API (Fastify, :3000) ────────┘
│       │
│       ▼
│  SandboxManager
│       │
│       ▼
│  Firecracker microVMs (jailer chroot)
│   - virtio-vsock control channel (length-prefixed JSON)
│   - 256 MB RAM, 10% vCPU each
│   - per-template rootfs snapshot, CoW-mmap'd on restore
```

Capacity on the reference VM: **17 concurrent microVMs**. Idle TTL: 5 min.

See `prd.md` for the v2 target architecture, the tiered roadmap, and non-goals.

## API surface (v1, shipped)

| Method | Path | Description |
|---|---|---|
| `POST` | `/sandboxes` | Create a sandbox (optional `template`) |
| `GET` | `/sandboxes` | List sandboxes (with count + max) |
| `GET` | `/sandboxes/:id` | Sandbox detail |
| `POST` | `/sandboxes/:id/execute` | Run JS — `{stdout, stderr, exitCode, durationMs, timedOut}` |
| `GET` | `/sandboxes/:id/logs` | Execution history |
| `DELETE` | `/sandboxes/:id` | Destroy sandbox |
| `GET` | `/metrics` | Prometheus metrics |
| `GET` | `/health` | Health check |
| `WS` | `/events` | Lifecycle events |

All endpoints (except `/health`) require `Authorization: Bearer <api-key>`. API keys are minted in the dashboard.

## Tests

```bash
npm test           # one-shot
npm run test:watch
```

Vitest with `BETTER_AUTH_SECRET=test-secret` baked into the npm script.

## Roadmap snapshot

- **v1 (shipped):** JS-only `execute`, Firecracker microVMs + jailer, snapshots, vsock guest channel, Better-Auth, dashboard, Terraform deploy.
- **v2 (in progress):** templates (node / python / browser), file I/O over vsock, networking + hardening (NAT, egress allowlist, bandwidth caps), multi-process exec, exposed ports, MCP server.
- **v3+:** worker fleet + Postgres, multi-region, user-uploaded templates, sandbox-hosted MCP gateway.

Full breakdown in `prd.md`.

## Security

- Firecracker microVM per sandbox; no shared FS.
- jailer drops to UID/GID 1000 on the host.
- Per-microVM cgroup CPU + memory limits; ext4 size cap.
- Execution timeout enforced.
- No network in the guest in v1; v2 adds NAT with internal-range deny, DNS allowlist, bandwidth + conntrack caps.
- TLS via Caddy auto-Let's-Encrypt in production.

## License

TBD.

## References

- Firecracker: <https://github.com/firecracker-microvm/firecracker>
- jailer: <https://github.com/firecracker-microvm/firecracker/blob/main/docs/jailer.md>
