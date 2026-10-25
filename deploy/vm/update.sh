#!/usr/bin/env bash
# Deploys the branch checked out on the server: pull, rebuild the images, restart what changed.
# Run on the server: ~/behandme/deploy/vm/update.sh
set -euo pipefail
cd "$(dirname "$0")"

for file in .env env/shared.env env/gateway.env env/notifier.env env/handover.env env/worker.env; do
  [[ -f $file ]] || { echo "Missing deploy/vm/$file (see deploy/vm/env-example/)"; exit 1; }
done

git -C ../.. pull --ff-only
docker compose build
docker compose up -d --remove-orphans
docker image prune -f >/dev/null
docker compose ps
