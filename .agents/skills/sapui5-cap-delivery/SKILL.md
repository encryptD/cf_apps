---
name: sapui5-cap-delivery
description: Use this skill for any SAPUI5 + CAP feature or bugfix in this repo; enforces V4 APIs, i18n correctness, routing, CORS-safe local setup, and BTP build validation.
---

# SAPUI5 + CAP Delivery Skill
## When to use
- Any task touching `webapp/`, `srv/`, `db/`, `mta.yaml`, `xs-security.json`, or `approuter/`.
- Any issue involving routing, i18n, OData requests, CORS, console errors, or BTP deployment.

## Required execution flow
1. Read `.agents/workflows/sapui5-cap-feature-workflow.yaml`.
2. Diagnose first, then patch only confirmed root causes.
3. Keep all user-facing text translatable via `i18n`.
4. Use SAPUI5 Router (`navTo`) and manifest routes/targets.
5. Use OData V4 patterns only:
   - list reads via `bindList(...).requestContexts(...)`
   - single reads via `bindContext(...).requestObject()`
   - creates via `bindList(...).create(...)` + `created()`
   - actions/functions via `bindContext('/action(...)')` + `setParameter(...)` + `execute()/requestObject()`
6. Keep local OData URI as relative (`/gatepass/`) and rely on UI5 proxy middleware for local dev.
7. For deployment-related changes, run `mbt build -p=cf -t .mtar_tmp`.

## Non-negotiable guardrails
- Do not use `oModel.read`, callback-style `oModel.create`, or callback-style `callFunction` for V4 model.
- Do not use invalid XML attributes like `data-route` on controls; use `core:CustomData`.
- Do not hardcode role defaults that hide required tiles; prefer explicit role source or safe default.
- Do not move `dataSources` out of `sap.app`.

## Quick verification checklist
- No `[FUTURE FATAL]` in console.
- No i18n missing-key assertions.
- No `$metadata` 404 for configured service.
- No CORS/$batch preflight failures in local flow.
- Dashboard tiles navigate correctly for expected roles.
