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
  description = "GCP zone (must support nested virtualization)"
  type        = string
  default     = "europe-west3-a"
}

variable "instance_name" {
  description = "Compute Engine instance name"
  type        = string
  default     = "sandboxjs"
}

variable "machine_type" {
  description = "Machine type — must support nested virtualization (N2, N2D, C2, C3, M2, M3). Tau T2A (ARM) is not supported."
  type        = string
  default     = "n2-standard-2"
}

variable "boot_disk_size_gb" {
  description = "Boot disk size in GB. Need room for OS + kernel + rootfs + chroot working dirs."
  type        = number
  default     = 30
}

variable "ssh_user" {
  description = "Linux username on the VM (GCP creates the account from this name)"
  type        = string
  default     = "ubuntu"
}

variable "ssh_pubkey_path" {
  description = "Path to SSH public key to install on the VM"
  type        = string
  default     = "~/.ssh/id_ed25519.pub"
}

variable "api_allowed_cidrs" {
  description = "CIDR ranges allowed to reach the API on port 3000. Default is open — restrict to your IP for production."
  type        = list(string)
  default     = ["0.0.0.0/0"]
}
