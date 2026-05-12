output "api_ip" {
  description = "Public IP of the API server"
  value       = google_compute_address.api.address
}

output "api_url" {
  description = "Public base URL for the SandboxJS API"
  value       = "http://${google_compute_address.api.address}:3000"
}

output "dashboard_url" {
  description = "Public base URL for the SandboxJS dashboard"
  value       = "http://${google_compute_address.api.address}:3001"
}

output "api_ssh_command" {
  description = "SSH into the API server"
  value       = "ssh ${var.ssh_user}@${google_compute_address.api.address}"
}

output "worker_ips" {
  description = "Public IPs of all worker VMs (SSH-only — port 7000 is firewalled to the API server tag)"
  value       = [for w in google_compute_address.worker : w.address]
}

output "worker_ssh_commands" {
  description = "SSH commands to reach each worker"
  value       = [for w in google_compute_address.worker : "ssh ${var.ssh_user}@${w.address}"]
}

output "worker_count" {
  description = "Number of worker VMs provisioned"
  value       = var.worker_count
}

output "ssh_user" {
  description = "Linux user on every VM (used by Makefile targets)"
  value       = var.ssh_user
}

output "instance_name" {
  description = "Base instance name (used as a tag and prefix)"
  value       = var.instance_name
}

output "zone" {
  description = "GCE zone (used by Makefile targets)"
  value       = var.zone
}

output "worker_token_hint" {
  description = "First 8 chars of the shared worker bearer token, for diagnostics"
  value       = "${substr(nonsensitive(random_password.worker_token.result), 0, 8)}…"
}
