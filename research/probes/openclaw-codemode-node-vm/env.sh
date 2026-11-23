# Source me: isolates OpenClaw state/config into this folder and sets the SPEC secret.
S="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)/state"
export HOME="$S" OPENCLAW_HOME="$S" OPENCLAW_STATE_DIR="$S/state" OPENCLAW_CONFIG_PATH="$S/openclaw.json" PROBE_SECRET=s3cr3t
