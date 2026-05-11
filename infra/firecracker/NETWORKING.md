# Runtime Networking

This document describes the baseline runtime networking setup for sandbox VMs.

## Goal

Allow outbound internet access for user code and AI agents while preparing for
policy controls such as allowlists, deny lists, and a hard boolean network-off switch.

## Host Requirements

Enable `ip_forward` on the host:

```bash
sysctl -w net.ipv4.ip_forward=1
```

Add outbound NAT with `iptables` on the internet-facing interface:

```bash
iptables -t nat -A POSTROUTING -s 172.20.0.0/16 -o eth0 -j MASQUERADE
```

## VM Model

Each sandbox gets:

- one host `TAP` device
- one Firecracker NIC attached to `eth0`
- one small point-to-point subnet from `172.20.0.0/16`

## Guardrails

Tier 1 should deny private IP ranges from sandbox egress:

- `10.0.0.0/8`
- `172.16.0.0/12`
- `192.168.0.0/16`
- `127.0.0.0/8`
- `169.254.0.0/16`

This is the foundation for request blocking and policy enforcement at runtime.
