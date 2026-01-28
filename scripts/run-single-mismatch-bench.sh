#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

GRAPH="graph-200.json"
GEN_SCRIPT="scripts/generateGraph.js"

COLLABS_PORT=3001
DEV_PORT=5173

COLLABS_PID_FILE=".tmp/collabs.pid"
DEV_PID_FILE=".tmp/dev.pid"
mkdir -p .tmp logs

# generate fixture if missing
if [ ! -f "$GRAPH" ]; then
  echo "Generating $GRAPH..."
  node "$GEN_SCRIPT" 200 1 "$GRAPH"
fi

is_port_open() {
  local port=$1
  nc -z localhost "$port" >/dev/null 2>&1
}

start_collabs_if_needed() {
  if is_port_open "$COLLABS_PORT"; then
    echo "Collabs WS already running on port $COLLABS_PORT; reusing."
    return 0
  fi
  echo "Starting collabs ws server on port $COLLABS_PORT..."
  npm run collabs-ws-server >logs/collabs-ws.log 2>&1 &
  echo $! > "$COLLABS_PID_FILE"
}

start_dev_if_needed() {
  if is_port_open "$DEV_PORT"; then
    echo "Dev server already running on port $DEV_PORT; reusing."
    return 0
  fi
  echo "Starting dev server (E2E mode)..."
  VITE_E2E=1 npm run dev >logs/dev.log 2>&1 &
  echo $! > "$DEV_PID_FILE"
}

wait_for_port() {
  local port=$1
  local timeout=${2:-60}
  local waited=0
  while ! is_port_open "$port"; do
    if [ "$waited" -ge "$timeout" ]; then
      echo "Timeout waiting for port $port" >&2
      return 1
    fi
    sleep 1
    waited=$((waited+1))
  done
  return 0
}

cleanup() {
  echo "Cleaning up..."
  if [ -f "$COLLABS_PID_FILE" ]; then
    pid=$(cat "$COLLABS_PID_FILE") || true
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" || true
    fi
    rm -f "$COLLABS_PID_FILE"
  fi
  if [ -f "$DEV_PID_FILE" ]; then
    pid=$(cat "$DEV_PID_FILE") || true
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" || true
    fi
    rm -f "$DEV_PID_FILE"
  fi
}

trap cleanup EXIT

start_collabs_if_needed
start_dev_if_needed

echo "Waiting for services to be ready..."
wait_for_port "$COLLABS_PORT" 30
wait_for_port "$DEV_PORT" 60

# Run the single-mismatch Playwright spec
echo "Running Playwright single-mismatch bench..."
export VITE_E2E=1
npx playwright test src/testing/multirep-feed.bench.spec.ts --workers=1

echo "Playwright finished."

# cleanup will run via trap
