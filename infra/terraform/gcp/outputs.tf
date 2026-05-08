output "instance_ip" {
  description = "Public IP of the SandboxJS VM"
  value       = google_compute_address.sandboxjs.address
}

output "ssh_command" {
  description = "SSH command to connect to the VM"
  value       = "ssh ${var.ssh_user}@${google_compute_address.sandboxjs.address}"
}

output "api_url" {
  description = "SandboxJS API base URL"
  value       = "http://${google_compute_address.sandboxjs.address}:3000"
}

output "deploy_command" {
  description = "Command to deploy the app to the VM"
  value       = "./infra/deploy/deploy-gcp.sh ${var.ssh_user}@${google_compute_address.sandboxjs.address}"
}

output "ssh_user" {
  description = "Linux user on the VM (used by Makefile targets)"
  value       = var.ssh_user
}

output "instance_name" {
  description = "GCE instance name (used by Makefile targets)"
  value       = var.instance_name
}

output "zone" {
  description = "GCE zone (used by Makefile targets)"
  value       = var.zone
}
