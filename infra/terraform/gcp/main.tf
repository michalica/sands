terraform {
  required_version = ">= 1.5"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
  zone    = var.zone
}

# Shared bearer token between API server and workers. Generated once,
# persisted in terraform state, injected via VM metadata.
resource "random_password" "worker_token" {
  length  = 48
  special = false
}

# ───────────────────── API server (control plane) ─────────────────────

resource "google_compute_address" "api" {
  name   = "${var.instance_name}-api-ip"
  region = var.region
}

resource "google_compute_firewall" "api_public" {
  name    = "${var.instance_name}-api-public"
  network = "default"

  allow {
    protocol = "tcp"
    ports    = ["3000", "3001"]
  }

  source_ranges = var.api_allowed_cidrs
  target_tags   = ["${var.instance_name}-api"]
}

resource "google_compute_firewall" "ssh" {
  name    = "${var.instance_name}-allow-ssh"
  network = "default"

  allow {
    protocol = "tcp"
    ports    = ["22"]
  }

  source_ranges = var.api_allowed_cidrs
  target_tags   = ["${var.instance_name}-api", "${var.instance_name}-worker"]
}

# Internal: API server → workers on the worker daemon port. Source is the
# API server's network tag, so only it can reach workers on port 7000.
resource "google_compute_firewall" "worker_internal" {
  name    = "${var.instance_name}-worker-internal"
  network = "default"

  allow {
    protocol = "tcp"
    ports    = ["7000"]
  }

  source_tags = ["${var.instance_name}-api"]
  target_tags = ["${var.instance_name}-worker"]
}

resource "google_compute_instance" "api" {
  name         = "${var.instance_name}-api"
  machine_type = var.api_machine_type
  zone         = var.zone
  tags         = ["${var.instance_name}-api"]

  boot_disk {
    initialize_params {
      image = "ubuntu-os-cloud/ubuntu-2404-lts-amd64"
      size  = var.api_boot_disk_size_gb
      type  = "pd-balanced"
    }
  }

  network_interface {
    network = "default"
    access_config {
      nat_ip = google_compute_address.api.address
    }
  }

  metadata = {
    ssh-keys               = "${var.ssh_user}:${file(pathexpand(var.ssh_pubkey_path))}"
    startup-script         = file("${path.module}/startup-api.sh")
    enable-oslogin         = "FALSE"
    block-project-ssh-keys = "TRUE"
    sandboxjs-ssh-user     = var.ssh_user
    sandboxjs-role         = "api"
    sandboxjs-worker-token = random_password.worker_token.result
  }

  service_account {
    scopes = ["cloud-platform"]
  }
}

# ───────────────────── Worker(s) ─────────────────────

resource "google_compute_address" "worker" {
  count  = var.worker_count
  name   = "${var.instance_name}-worker-${count.index}-ip"
  region = var.region
}

resource "google_compute_instance" "worker" {
  count        = var.worker_count
  name         = "${var.instance_name}-worker-${count.index}"
  machine_type = var.worker_machine_type
  zone         = var.zone
  tags         = ["${var.instance_name}-worker"]

  advanced_machine_features {
    enable_nested_virtualization = true
  }

  boot_disk {
    initialize_params {
      image = "ubuntu-os-cloud/ubuntu-2404-lts-amd64"
      size  = var.worker_boot_disk_size_gb
      type  = "pd-balanced"
    }
  }

  network_interface {
    network = "default"
    access_config {
      # Public IP for SSH access only; port 7000 is firewalled to the API
      # server tag, and there are no other public ports.
      nat_ip = google_compute_address.worker[count.index].address
    }
  }

  metadata = {
    ssh-keys                    = "${var.ssh_user}:${file(pathexpand(var.ssh_pubkey_path))}"
    startup-script              = file("${path.module}/startup-worker.sh")
    enable-oslogin              = "FALSE"
    block-project-ssh-keys      = "TRUE"
    sandboxjs-ssh-user          = var.ssh_user
    sandboxjs-role              = "worker"
    sandboxjs-worker-token      = random_password.worker_token.result
    sandboxjs-worker-id         = "${var.instance_name}-worker-${count.index}"
    sandboxjs-control-plane-url = "http://${google_compute_instance.api.network_interface[0].network_ip}:3000"
  }

  service_account {
    scopes = ["cloud-platform"]
  }
}
