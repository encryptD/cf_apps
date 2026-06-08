---
name: sapui5-hotfix
description: Fast-path SAPUI5 hotfix skill for console/runtime errors (i18n, routing, OData V4, CORS/proxy, manifest wiring), with minimal safe changes and immediate validation.
---

# SAPUI5 Hotfix
## When to use
- Production-like issue triage for failing pages, broken tile navigation, or console fatals.
- Use when the priority is restoring functionality quickly with the smallest safe patch.

## Hotfix protocol
1. Reproduce and isolate exact error lines/messages first.
2. Classify into one bucket:
   - i18n/config (missing keys, locale/fallback mismatch)
   - manifest wiring (wrong section/path/model datasource)
   - OData API mismatch (V2 methods on V4 model)
   - routing/view binding issues
   - CORS/proxy/deployment path
3. Patch only the confirmed root cause (avoid refactors unless needed to unblock).
4. Re-run immediate validation:
   - impacted navigation/tile press
   - console free of prior fatal/assertion
   - OData request path and `$metadata` reachable
5. If fix touches deployment files, run: `mbt build -p=cf -t .mtar_tmp`.

## Required guardrails
- Prefer relative service URI (`/gatepass/`) + proxy for local UI5.
- Keep `sap.app.dataSources` and `sap.ui5.models` wiring valid.
- Use OData V4 patterns only (no `.read` or callback-style V2 calls).
- Use i18n keys for UI text and ensure key existence in bundle files.
- Use `core:CustomData` for control metadata instead of ad-hoc XML attributes.

## Hotfix completion criteria
- Original console errors resolved.
- No new fatal/assertion introduced.
- User-visible flow impacted by the error works end-to-end.
