variable "project_id" {
  description = "GCP project ID"
  type        = string
}

variable "region" {
  description = "GCP region"
  type        = string
  default     = "europe-west3"
}

variable "zone" {
  description = "GCP zone (must support nested virtualization on worker types)"
  type        = string
  default     = "europe-west3-a"
}

variable "instance_name" {
  description = "Base name for all instances; used as a prefix and tag"
  type        = string
  default     = "sandboxjs"
}

variable "api_machine_type" {
  description = "Machine type for the API server / dashboard / control plane. No nested virt required."
  type        = string
  default     = "e2-small"
}

variable "worker_machine_type" {
  description = "Machine type for each worker. Must support nested virtualization (N2, N2D, C2, C3, M2, M3). Tau T2A (ARM) is not supported."
  type        = string
  default     = "n2-standard-2"
}

variable "worker_count" {
  description = "Number of worker VMs to provision."
  type        = number
  default     = 1
}

variable "api_boot_disk_size_gb" {
  description = "Boot disk size for the API server (OS + Node + dashboard build)."
  type        = number
  default     = 20
}

variable "worker_boot_disk_size_gb" {
  description = "Boot disk size for each worker (OS only — data goes to a separate XFS disk)."
  type        = number
  default     = 20
}

variable "worker_data_disk_size_gb" {
  description = "Separate XFS data disk per worker. Holds /opt/sandboxjs (kernels, rootfs, snapshots, jailer chroots). XFS+reflink makes per-VM rootfs clones near-instant."
  type        = number
  default     = 30
}

variable "ssh_user" {
  description = "Linux username on every VM (GCP creates the account from this name)"
  type        = string
  default     = "ubuntu"
}

variable "ssh_pubkey_path" {
  description = "Path to SSH public key to install on every VM"
  type        = string
  default     = "~/.ssh/id_ed25519.pub"
}

variable "api_allowed_cidrs" {
  description = "CIDR ranges allowed to reach the public API + dashboard ports and to SSH into VMs. Default is open — restrict to your IP for production."
  type        = list(string)
  default     = ["0.0.0.0/0"]
}
