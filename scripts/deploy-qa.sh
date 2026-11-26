#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
QA_SOURCE_DIR="$ROOT_DIR/qa"
TARGET_DIR="$ROOT_DIR/.mtar_tmp"
MTAR_NAME="${QA_MTAR_NAME:-gatepass_test_1.0.0.mtar}"
QA_WEBAPP_DIR="$QA_SOURCE_DIR/webapp-test"

if ! command -v mbt >/dev/null 2>&1; then
  echo "mbt command not found. Install SAP Cloud MTA Build Tool first."
  exit 1
fi

if ! command -v cf >/dev/null 2>&1; then
  echo "cf command not found. Install Cloud Foundry CLI first."
  exit 1
fi

echo "Building QA MTAR from $QA_SOURCE_DIR ..."
rm -rf "$QA_WEBAPP_DIR"
mkdir -p "$QA_WEBAPP_DIR"
cp -R "$ROOT_DIR/webapp/." "$QA_WEBAPP_DIR/"
QA_WEBAPP_DIR="$QA_WEBAPP_DIR" python3 - <<'PY'
import json
import os
from pathlib import Path
manifest = Path(os.environ["QA_WEBAPP_DIR"]) / "manifest.json"
data = json.loads(manifest.read_text())
sap_app = data.setdefault("sap.app", {})
sap_app["id"] = "com.mdasad.gatepass.test"
app_ver = sap_app.setdefault("applicationVersion", {})
app_ver["version"] = "1.0.1"
manifest.write_text(json.dumps(data, indent=2) + "\n")
PY
rm -f "$QA_WEBAPP_DIR/gatepass-ui-test.zip"
rm -rf "$TARGET_DIR/.qa_mta_build_tmp"
mbt build -p=cf -s "$QA_SOURCE_DIR" -t "$TARGET_DIR" --mtar "$MTAR_NAME"

echo "Deploying QA MTAR $TARGET_DIR/$MTAR_NAME ..."
cf deploy "$TARGET_DIR/$MTAR_NAME" -f

echo "QA deployment completed."
