#!/usr/bin/env bash
# One-time setup of the server (Ubuntu 24.04 on Oracle Cloud): Docker, the firewall for HTTP and HTTPS,
# automatic security updates and some swap for the builds. Safe to run again.
# Run as the default user (ubuntu): bash setup-server.sh, then log out and in (docker group).
set -euo pipefail

sudo apt-get update
sudo apt-get install -y ca-certificates curl git unattended-upgrades netfilter-persistent iptables-persistent

# Docker Engine and the Compose plugin, from Docker's repository.
if ! command -v docker >/dev/null; then
  sudo install -m 0755 -d /etc/apt/keyrings
  sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  sudo chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" |
    sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
  sudo apt-get update
  sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
sudo usermod -aG docker "$USER"

# Oracle's Ubuntu images reject every incoming port but SSH in iptables (on top of the VCN's security
# list): accept HTTP and HTTPS before that REJECT rule, and keep the rules across reboots.
for port in 80 443; do
  if ! sudo iptables -C INPUT -p tcp --dport "$port" -m state --state NEW -j ACCEPT 2>/dev/null; then
    reject=$(sudo iptables -L INPUT --line-numbers -n | awk '$2 == "REJECT" { print $1; exit }')
    sudo iptables -I INPUT "${reject:-1}" -p tcp --dport "$port" -m state --state NEW -j ACCEPT
  fi
done
sudo netfilter-persistent save

# Security updates, installed every day.
echo 'unattended-upgrades unattended-upgrades/enable_auto_updates boolean true' | sudo debconf-set-selections
sudo dpkg-reconfigure -f noninteractive unattended-upgrades

# 2 GB of swap: building four images on a small machine needs more than its memory at times.
if ! sudo swapon --show | grep -q /swapfile; then
  sudo fallocate -l 2G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi

echo "Done. Log out and back in, so that docker runs without sudo."
