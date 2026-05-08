terraform {
  required_version = ">= 1.5"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
  zone    = var.zone
}

resource "google_compute_address" "sandboxjs" {
  name   = "${var.instance_name}-ip"
  region = var.region
}

resource "google_compute_firewall" "sandboxjs_api" {
  name    = "${var.instance_name}-allow-api"
  network = "default"

  allow {
    protocol = "tcp"
    ports    = ["3000", "3001"]
  }

  source_ranges = var.api_allowed_cidrs
  target_tags   = [var.instance_name]
}

resource "google_compute_firewall" "sandboxjs_ssh" {
  name    = "${var.instance_name}-allow-ssh"
  network = "default"

  allow {
    protocol = "tcp"
    ports    = ["22"]
  }

  source_ranges = var.api_allowed_cidrs
  target_tags   = [var.instance_name]
}

resource "google_compute_instance" "sandboxjs" {
  name         = var.instance_name
  machine_type = var.machine_type
  zone         = var.zone
  tags         = [var.instance_name]

  advanced_machine_features {
    enable_nested_virtualization = true
  }

  boot_disk {
    initialize_params {
      image = "ubuntu-os-cloud/ubuntu-2404-lts-amd64"
      size  = var.boot_disk_size_gb
      type  = "pd-balanced"
    }
  }

  network_interface {
    network = "default"
    access_config {
      nat_ip = google_compute_address.sandboxjs.address
    }
  }

  metadata = {
    ssh-keys                  = "${var.ssh_user}:${file(pathexpand(var.ssh_pubkey_path))}"
    startup-script            = file("${path.module}/startup-script.sh")
    enable-oslogin            = "FALSE"
    block-project-ssh-keys    = "TRUE"
    sandboxjs-ssh-user        = var.ssh_user
  }

  service_account {
    scopes = ["cloud-platform"]
  }
}
