# GatePass Handover and Deployment Finalization Runbook
## 0ae) Latest Update (2026-08-17) — GateEntries 500 Root Cause and Resolution
### 0ae.1 User-visible incident
- UI failed while loading Gate Entries with backend errors on:
  - `/gatepass/GateEntries`
  - `/gatepass/$batch`
- Runtime symptom in logs: relation lookup failures on `gatepassservice_gateentries`.

### 0ae.2 Confirmed root cause
- Service projection objects (`gatepassservice_*`) were present in schema `gatepass`, but active runtime DB sessions were not using that schema in `search_path`.
- In-app probe evidence before fix showed:
  - `search_path`: `"$user", public, extensions`
  - `current_schema()`: `public`
  - Query failure: `42P01 relation "gatepassservice_gateentries" does not exist`
- This caused unqualified CAP SQL lookups to miss objects in `gatepass`.

### 0ae.3 Fix applied
- Applied minimal DB-side fix on the application role:
  - Set default role `search_path` to `gatepass, public`.
- Restarted `gatepass-srv` so pooled DB connections pick up updated role defaults.

### 0ae.4 Post-fix verification evidence
- New DB sessions resolve schema context correctly:
  - `search_path`: `gatepass, public`
  - `current_schema()`: `gatepass`
- In-app probe query now succeeds:
  - `select count(*) from gatepassservice_gateentries` -> success (`0` rows, no relation error).
- Outcome: relation-not-found blocker removed; GateEntries path restored.

### 0ae.5 Operational note
- Keep schema resolution consistent across layers:
  - CAP runtime config (`schema: gatepass`)
  - DB role default `search_path`
  - Any environment-level `PGOPTIONS` overrides
- If a similar `42P01` reappears, verify effective session `search_path` first.
## 0ad) Latest Update (2026-08-17) — External Postgres Reachability Probe and Handover
### 0ad.1 Objective
- Validate whether the external Postgres endpoint can be reached from both local environment and current CF runtime for GatePass integration planning.

### 0ad.2 Inputs used
- External DB host: `pgdb.vertexassist.com`
- External DB port: `5432`
- Env file: `.env-supabase` (verified key names only; no secret values exposed)

### 0ad.3 Probe results (evidence)
- Local probe from workstation:
  - DNS resolution: success
  - TCP connectivity to `pgdb.vertexassist.com:5432`: success
- CF runtime probe from `gatepass-srv`:
  - `cf ssh gatepass-srv` path was not usable in this space (`not authorized` for SSH action).
  - Fallback probe executed successfully via `cf run-task`:
    - Task name: `dbprobe1786963349`
    - Task id: `28`
    - Log evidence:
      - `DBPROBE DNS_OK 31.97.111.43`
      - `DBPROBE TCP_OK`

### 0ad.4 Current CF app/service state snapshot
- `cf mta gatepass`:
  - Apps: `gatepass-srv` and `gatepass-app-router` are `STARTED`.
  - Service `gatepass-db` (`hana`, `hdi-shared`) remains `create failed`.
  - Service `gatepass-uaa` remains `update failed`.
- `cf services` confirms `gatepass-db` is still in failed state and unbound.

### 0ad.5 Implications for architecture decision
- External Postgres endpoint is network-reachable from current CF runtime at TCP layer.
- This is sufficient to proceed with external-DB integration design (subject to app-level auth/TLS validation).
- If moving away from HANA/HDI, `mta.yaml` should remove HANA-specific resource/module wiring to avoid repeated failed provisioning attempts.

### 0ad.6 Recommended next actions
1. Confirm final DB strategy: external Postgres (self-hosted Supabase) vs HANA.
2. If external Postgres is selected:
   - Switch CAP production DB adapter to Postgres.
   - Remove HANA HDI resources/modules from main `mta.yaml`.
   - Bind DB credentials securely via CF service/env (no secrets in git).
3. Run an authenticated DB connectivity test from CF runtime (not just TCP), then execute CAP smoke tests.
4. Keep strict IP allowlist active on Postgres ingress and verify CF egress compatibility.

### 0ad.7 Repo snapshot note for next agent
- Working tree currently contains multiple unrelated modified files (UI/service/QA/build artifacts) in addition to infra changes.
- Any new DB migration commit should stage only intended files to avoid mixing unrelated changes.
## Stakeholder Executive Summary (2026-06-30)
- Overall status: S/4 Purchase Order and Goods Receipt integrations are operational with improved production-grade error semantics.
- Business impact addressed:
  - Eliminated misleading technical `502` errors for S/4 authorization failures by mapping them to explicit `403` responses with actionable messages.
  - Restored GateEntry PO auto-population by correcting destination targeting drift (`MY410651` reverted to the intended S/4 base URL).
  - Restored GatePass usability by fixing item-row checkbox selection behavior and backend GR item-status parsing.
- Platform stability improvements:
  - Hardened CAP remote error handling for both PO and GR service groups.
  - Standardized Node runtime compatibility for CF staging by updating engine specification to a buildpack-supported version (`22.x`).
- Deployment status: latest combined fixes are deployed successfully (operation `d30410a4-745f-11f1-a174-eeee0a825d22`).
- Current risk posture:
  - Low for application-layer regressions in the corrected flows.
  - Residual dependency remains on external S/4 data/authorization state for live business outcomes.
- Recommended leadership follow-up:
  1. Keep destination governance and credential rotation under change control.
  2. Continue monitoring for service-group authorization drifts (`API_PURCHASEORDER_2`, `API_SSPOPENITMGOODSRECEIPT`).
  3. Retain this runbook as the baseline incident-response pattern for future S/4 connectivity issues.
## Executive Summary
- Status: live S/4 connectivity is now operational for CAP remote service `purchaseorder_api`.
- Primary incident: outbound destination resolution/authentication failures blocked smoke validation in CF runtime.
- Final resolution: destination `MY410651` was corrected to `BasicAuthentication` with communication user credentials and the URL was set to the exact S/4 Purchase Order OData service root.
- Verification outcome: runtime smoke task `po-smoke-1781980044-my410651-final` succeeded with log evidence `PO_SMOKE_OK count=100`.
- Current runtime controls:
  - `gatepass-srv` bound to `gatepass-destination` and `gatepass-uaa`
  - `CDS_CONFIG` override points `purchaseorder_api` to destination `MY410651`
  - `PO_SOURCE=live` used for strict live validation
- Code/runtime hardening delivered:
  - Added required SAP Cloud SDK runtime dependencies for CAP remote calls.
  - Updated PO remote-call path in `srv/gatepass-service.js` to use request-context transaction where applicable (`oPOService.tx(req)`).
- Immediate follow-up:
  1. Keep destination credentials managed externally and rotated.
  2. Re-run smoke after any destination/auth change.
  3. Optionally revert `PO_SOURCE` to `auto` for operational fallback behavior.
## 0ac) Latest Update (2026-06-30) — Comprehensive Incident Handover for S/4 Destination and GatePass Item Selection
### 0ac.1 Scope and symptoms
- Scope covered in this handover window:
  - S/4 remote-call behavior for Purchase Order and Goods Receipt APIs.
  - Destination targeting drift and resulting functional impact in GateEntry/GatePass.
  - GatePass item checkbox selection behavior during GR-enabled processing.
- User-visible symptoms observed across runs:
  - `/getGoodsReceiptOpenItems(...)` and `/getPurchaseOrderSnapshot(...)` surfaced as `502` before backend error mapping updates.
  - GateEntry PO lookup intermittently returned no content (empty field population).
  - GatePass item row checkboxes could not be retained as selected.

### 0ac.2 Confirmed root causes
- Root cause A — Upstream S/4 authorization failures were wrapped as generic communication errors:
  - S/4 responded `403 Forbidden` with SAP code `/IWBEP/CM_V4_COS/011` for service groups:
    - `API_SSPOPENITMGOODSRECEIPT`
    - `API_PURCHASEORDER_2`
  - CAP remote client wrapped these into technical error flow, which appeared as `502` unless explicitly translated.
- Root cause B — Destination target drift:
  - Destination `MY410651` temporarily pointed to `https://my410653-api.s4hana.cloud.sap/sap/opu/odata4`.
  - For expected PO numbers in business flow, upstream returned `404` (`/IWBEP/CM_V4S_RUN/000`), and GateEntry ended up with no PO data (`204` functional no-content response from CAP).
- Root cause C — GatePass UI selection logic:
  - In `webapp/controller/GatePassList.controller.js`, `_applyGoodsReceiptSelectionState` removed row selection immediately for items flagged non-GR-selectable, effectively preventing persistent checkbox selection by users.
- Root cause D — GR boolean normalization defect:
  - `DeliveryStatus` was parsed via `Boolean(...)` in `srv/gatepass-service.js`.
  - String values such as `"false"` are truthy in JavaScript and could incorrectly mark rows as delivered/non-open, reducing or eliminating eligible rows.
- Root cause E — CF staging constraint during hotfix deployment:
  - Node buildpack runtime changed and no longer matched `engines.node: 20.x`.
  - Intermediate engine expression `>=22 <25` was rejected by buildpack parser as improper constraint.

### 0ac.3 Fixes implemented
- Backend error semantics hardening (`srv/gatepass-service.js`):
  - Added and used reusable remote-error classifiers.
  - Mapped PO and GR authorization failures to explicit `403` with actionable messages instead of generic `502`.
  - Applied mappings to:
    - `getPurchaseOrderDetails`
    - `getPurchaseOrderSnapshot`
    - GateEntry prefill path during PO auto-populate
    - `getGoodsReceiptOpenItems`
    - `postGoodsReceipt`
- Destination correction:
  - Updated destination `MY410651` URL back to `https://my410644-api.s4hana.cloud.sap/sap/opu/odata4` via Destination API delete-and-recreate flow (PATCH/PUT unsupported in this subaccount API behavior).
  - Preserved existing destination authentication profile (`BasicAuthentication`, user `API_BP_USER`).
- GatePass UI behavior fix (`webapp/controller/GatePassList.controller.js`):
  - Removed forced deselection of non-GR-eligible rows so item checkboxes remain user-selectable.
  - Kept GR action gating intact by computing GR payload from eligible selected rows only.
- GR open-item parsing fix (`srv/gatepass-service.js`):
  - Replaced direct `Boolean(...)` cast with robust `_toBoolean(...)` normalization for string/number/boolean payloads.
- CF deployability fix:
  - Updated `package.json` Node engine to `22.x` (buildpack-compatible format).

### 0ac.4 Troubleshooting milestones (chronological)
1. Authorization surfaced and translated:
   - Confirmed S/4 `403` for PO/GR service groups.
   - Implemented backend `403` mapping for clear operational diagnosis.
2. Destination/path investigation:
   - Correlated GateEntry empty PO behavior with live `404` responses for expected PO numbers.
   - Verified destination target drift to `my410653` and restored `MY410651` to `my410644`.
3. Runtime re-verification after destination correction:
   - `getPurchaseOrderDetails(poNumber='5100000362')` returned `200` with plant/vendor payload again.
4. GatePass checkbox triage:
   - Identified client logic that auto-removed selections and patched it.
   - Identified backend `DeliveryStatus` casting risk and patched normalization.
5. Deployment blocker handling:
   - Traced repeated CF staging failures to Node engine mismatch/format.
   - Iterated engine configuration and finalized deployable value `22.x`.

### 0ac.5 Validation and deployment evidence
- Relevant successful deployment operations:
  - PO authorization mapping deployment: `a720a504-708d-11f1-b89a-eeee0a948623`
  - Combined GatePass UI + GR parsing + engine compatibility deployment: `d30410a4-745f-11f1-a174-eeee0a825d22`
- Notable failed deployment operations during troubleshooting (resolved):
  - `6998f0d5-745c-11f1-8594-eeee0a869b30`
  - `b4b00108-745d-11f1-9baa-eeee0a96eb60`
  - `dac50a5d-745e-11f1-b440-eeee0a81628f`
- Runtime verification highlights:
  - PO endpoint after destination correction:
    - `GET /gatepass/getPurchaseOrderDetails(poNumber='5100000362')` -> `200` with non-empty supplier/plant payload.
  - Authorization mapping verification:
    - PO and GR authorization denials now emit `403` with service-group-specific messages.
  - GatePass selection behavior:
    - Row checkbox selection is no longer forcibly cleared by controller logic.

### 0ac.6 Current operational state
- S/4 PO/GR API connectivity and authorization are functionally aligned with current runtime.
- Destination `MY410651` points to the intended base URL (`my410644`).
- GatePass item selection logic has been corrected and deployed.
- Error semantics are now actionable:
  - authorization -> explicit `403`
  - not-found PO in live mode -> functional no-content behavior (not transport `502`)
## 0ab) Latest Update (2026-06-22) — Goods Receipt Authorization Errors Mapped to 403
### 0ab.1 Problem summary
- User symptom: `/getGoodsReceiptOpenItems(...)` surfaced as `502 Bad Gateway` even though the upstream issue was authorization-related.
- Affected flow: Goods Receipt open-items fetch and Goods Receipt posting path when S/4 authorization is missing.

### 0ab.2 Confirmed root cause
- Recent `gatepass-srv` logs showed upstream S/4 response `403 Forbidden` for service group `API_SSPOPENITMGOODSRECEIPT`.
- CAP remote-call error wrapping caused the UI-facing response to appear as a generic communication `502`.
- Representative upstream SAP error code: `/IWBEP/CM_V4_COS/011` (`No authorization to access service group 'API_SSPOPENITMGOODSRECEIPT'`).

### 0ab.3 Fix implemented
- File updated: `srv/gatepass-service.js`
- Added reusable remote-error helpers:
  - `_getRemoteErrorStatus(error)`
  - `_getRemoteErrorCode(error)`
  - `_getRemoteErrorMessage(error)`
  - `_isRemoteAuthorizationError(error)`
  - `_buildGRAuthorizationErrorMessage(error)`
- Updated handlers to return explicit `403` for upstream auth failures:
  - `_onGetGoodsReceiptOpenItems` now catches remote auth errors and returns `req.reject(403, ...)`.
  - `_onPostGoodsReceipt` now maps auth failures during both open-item fetch and post execution to `req.reject(403, ...)`.
- Non-authorization errors continue to bubble up unchanged for normal technical diagnostics.

### 0ab.4 Validation evidence
- `npx cds compile srv/gatepass-service.cds` -> success (exit code 0).
- `npm run build` -> success (`ui5 build` completed successfully).

### 0ab.5 Operational outcome
- Goods Receipt authorization failures now return a clear `403` response with an authorization-specific message instead of a generic `502`.
- This preserves actionable error semantics for operations/security teams while maintaining existing handling for non-auth failures.
## 0) Latest Update (2026-06-21) — 502 Handling for Missing Purchase Orders
### 0.1 Problem summary
- User symptom: UI showed `Failed to invoke /getPurchaseOrderDetails(...)` with `502 Bad Gateway`.
- Affected flow: Gate Entry PO lookup on Enter/submit.
- Observed behavior: valid live PO lookups worked, but unknown/invalid PO numbers caused backend 502 instead of functional “not found” behavior.

### 0.2 Confirmed root cause
- Recent `gatepass-srv` logs showed CAP remote call failures at:
  - `GET /PurchaseOrder('<po>')?$select=PurchaseOrder,Supplier`
- Upstream S/4 response was `404 Not Found` (not transport failure), wrapped by CAP remote client as 502.
- Representative upstream error details:
  - SAP code: `/IWBEP/CM_V4S_RUN/000`
  - Message: `Unspecified provider error occurred. See Error Context and Call Stack.`
- Resulting issue: missing PO numbers were treated as technical exceptions and surfaced to UI as 502.

### 0.3 Fix implemented
- File updated: `srv/gatepass-service.js`
- Added helper: `_isRemoteNotFoundError(error)` to classify remote not-found responses using:
  - HTTP status `404`, or
  - SAP error code containing `/IWBEP/CM_V4S_RUN/000`.
- Updated live-mode path in `_fetchPORows`:
  - `live` now catches not-found errors and returns `[]` (functional no-data result),
  - other errors are still re-thrown (preserves visibility for real integration/runtime issues).
- This keeps strict live mode behavior while preventing false 502s for user-entered non-existent PO numbers.

### 0.4 Deployment and verification
- Build/deploy performed successfully:
  - `npx cds compile srv/gatepass-service.cds`
  - `npx cds build --production`
  - `npx mbt build -p=cf -t mta_archives`
  - `cf deploy mta_archives/gatepass_1.0.0.mtar -f`
- Deployment operation ID:
  - `0fba20ba-6d30-11f1-9fd2-eeee0a89c132`
- Runtime verification task:
  - `po-smoke-1782019174-notfound-handling` (task id `23`) -> `SUCCEEDED`
  - Evidence from logs:
    - `PO_FETCH_VERIFY_OK knownPo=4500000000 knownRows=3 missingRows=0`
    - `Live PO lookup returned not-found for 1111111.`

### 0.5 Operational outcome
- Known/missing PO behavior after fix:
  - Existing PO: lookup returns header/item-derived data as before.
  - Non-existent PO: returns empty result (no backend 502 propagation).
- Recommended monitoring:
  - continue checking `cf logs gatepass-srv --recent` for recurring `getPurchaseOrderDetails` 502 entries;
  - if a 502 reappears, capture PO number + timestamp + correlation id for targeted trace.
## 0a) Final Update (2026-06-21) — Gate Entry Loader While Waiting for S/4
### 0b.1 Problem summary
- User symptom: during Gate Entry PO lookup, the UI appeared idle while waiting for S/4 response, giving no feedback that backend lookup was in progress.
- Affected flow: Gate Entry app, PO reference input path invoking `/getPurchaseOrderDetails(...)`.

### 0b.2 Fix implemented
- Files updated:
  - `webapp/controller/GateEntryList.controller.js`
  - `webapp/view/GateEntryList.view.xml`
- Implementation details:
  - Added `entry>/isLoading` state in Gate Entry JSON model.
  - In `_populateFromPONumber`, set `isLoading=true` before `getPurchaseOrderDetails` execution and reset to `false` in `finally`.
  - Bound Gate Entry page busy indicator to `busy="{entry>/isLoading}"` with `busyIndicatorDelay="0"` for immediate loader display while waiting for S/4.
- Behavior after fix:
  - Loader is shown during S/4 PO fetch and clears on both success and failure.
  - Existing message handling remains unchanged (`Could not fetch Purchase Order details` on error).

### 0b.3 Build, deployment, and runtime verification
- Validation/build commands:
  - `npm run build` -> success
  - `npx mbt build -p=cf -t mta_archives` -> success (`mta_archives/gatepass_1.0.0.mtar`)
- Deployment command:
  - `cf deploy mta_archives/gatepass_1.0.0.mtar -f`
- Deployment operation ID:
  - `d3a4b904-6d38-11f1-9ed1-eeee0a88464c`
- Post-deploy health evidence (`cf logs gatepass-srv --recent`):
  - `server listening on { url: 'http://localhost:8080' }`
  - `server v9.9.1 launched in 466 ms`
  - process/container reached ready/healthy state.

### 0b.4 Handover outcome
- Gate Entry UX now provides clear loading feedback during live S/4 response wait windows.
- Deployment is completed and runtime is healthy in CF.
## 0aa) Final Update (2026-06-21) — GateExit Binding Synchronization
### 0aa.1 Problem summary
- User symptom: GateExit selection fields could drift out of sync when combo selections were populated from cached list data only.
- Affected flow: GateExit app Gate Entry / Gate Pass selection and downstream snapshot/material-item display bindings.

### 0aa.2 Fix implemented
- Files updated:
  - `webapp/controller/GateExit.controller.js`
  - `webapp/view/GateExit.view.xml`
- Implementation details:
  - Added stable JSON model paths for list bindings (`passIssuedEntries`, `gatePasses`) at initialization.
  - Bound ComboBox `selectedKey` to model state:
    - Gate Entry -> `exit>/gateEntry_ID`
    - Gate Pass -> `exit>/gatePass_ID`
  - Added `selectionChange` handlers (along with existing `change`) for immediate sync behavior.
  - In `onGateEntryChange`, applied immediate selected snapshot, then refreshed the selected Gate Entry via OData and re-applied latest values.
  - In `onGatePassChange`, applied immediate cached pass items, then refreshed selected Gate Pass via OData (`$expand=items`) and re-synced material rows.
- Behavior after fix:
  - GateExit UI remains consistent with latest backend state after selections.
  - Snapshot fields and item table update reliably even when initial combo data is stale.

### 0aa.3 Build, deployment, and runtime verification
- Validation/build commands:
  - `npm run build` -> success
  - `npx mbt build -p=cf -t mta_archives` -> success (`mta_archives/gatepass_1.0.0.mtar`)
- Deployment command:
  - `cf deploy mta_archives/gatepass_1.0.0.mtar -f`
- Deployment operation ID:
  - `4745ed2c-6d42-11f1-9ed1-eeee0a88464c`
- Post-deploy health evidence (`cf logs gatepass-srv --recent`):
  - `server listening on { url: 'http://localhost:8080' }`
  - process ready payload reported `ready=true`
  - container transitioned to healthy state.

### 0aa.4 Handover outcome
- GateExit binding and selection synchronization is now hardened against stale client-side snapshots.
- Deployment is completed and runtime is healthy in CF.
## 0b) Latest Update (2026-06-20) — S/4 Destination Resolution and Live Connectivity Validation
### 0.1 Problem summary
- Objective in this run: restore successful live S/4 connectivity for CAP remote service `purchaseorder_api` after Phase 1/2 integration.
- Symptom observed during smoke tasks from `gatepass-srv`: remote call to S/4 failed repeatedly at destination resolution/header build stage.
- Target outcome: complete app deployment and confirm successful runtime smoke call to live Purchase Order API using destination `MY410651`.

### 0.2 Binding and runtime configuration details
- CAP remote service wiring:
  - `package.json` includes `cds.requires.purchaseorder_api` with `kind: odata-v4`.
  - Runtime destination override applied on app:
    - `CDS_CONFIG={"requires":{"purchaseorder_api":{"credentials":{"destination":"MY410651"}}}}`
- Runtime source mode:
  - `PO_SOURCE=live` on `gatepass-srv` to force live path (no fallback during smoke validation).
- Cloud Foundry service bindings on `gatepass-srv`:
  - `gatepass-destination`
  - `gatepass-uaa`
- Final validated destination profile (`MY410651`):
  - `Type`: `HTTP`
  - `ProxyType`: `Internet`
  - `Authentication`: `BasicAuthentication`
  - `User`: communication user `API_BP_USER`
  - `Password`: maintained securely outside docs/source control
  - `URL`: `https://my410644-api.s4hana.cloud.sap/sap/opu/odata4/sap/api_purchaseorder_2/srvd_a2x/sap/purchaseorder/0001`

### 0.3 Troubleshooting milestones (chronological)
1. Deployment and initial smoke setup
   - Deployed latest MTAR successfully to CF.
   - Forced live mode on `gatepass-srv` (`PO_SOURCE=live`) and executed smoke task using `/PurchaseOrder`.
2. First blocker: missing runtime dependency
   - Failure: `Cannot find module '@sap-cloud-sdk/resilience'`.
   - Action: added required Cloud SDK runtime packages and redeployed.
3. Second blocker: destination auth mode mismatch
   - Failure after redeploy: `Failed to load destination ... No user token (JWT) ... necessary for 'SAMLAssertion'`.
   - Action: inspected destination behavior and moved to dedicated destination `MY410651`.
4. Third blocker: OAuth client misconfiguration
   - Failure on `MY410651`: `invalid_client` during token/header build while configured as `OAuth2ClientCredentials`.
   - Action: updated destination authentication to `BasicAuthentication` with communication user/password.
5. Fourth blocker: incorrect destination base URL
   - Failure after auth switch: HTTP `403 Access Denied`.
   - Log evidence showed remote request target was missing API service root path.
   - Action: corrected destination URL to PO OData service root path.
6. Final verification
   - Smoke task `po-smoke-1781980044-my410651-final` succeeded.
   - Runtime evidence: `PO_SMOKE_OK count=100`.

### 0.4 Code/config changes completed in this run
- Backend runtime robustness:
  - Added Cloud SDK runtime dependencies required by CAP remote service execution.
  - Updated `srv/gatepass-service.js` PO live-call path to use request context transaction (`oPOService.tx(req)`) for proper auth-context propagation where applicable.
- App runtime configuration:
  - `gatepass-srv` configured to use destination override `MY410651` via `CDS_CONFIG`.
  - `PO_SOURCE=live` preserved for live validation.

### 0.5 Current state at handover
- CF deployment status: healthy (`gatepass-srv`, `gatepass-app-router` started).
- Live S/4 connectivity status: verified via successful runtime smoke task.
- Destination status: `MY410651` is now usable by CAP remote service with basic communication-user authentication and corrected service-root URL.

### 0.6 Operational follow-up checklist
1. Keep destination `MY410651` credentials rotated per policy (no plaintext in repo/docs).
2. If desired, remove temporary runtime override by aligning design-time config to chosen destination strategy.
3. Re-run smoke after any destination/auth changes:
   - `cf run-task gatepass-srv ... /PurchaseOrder`
   - confirm `PO_SMOKE_OK` in recent logs.
4. Preserve `PO_SOURCE=live` only for strict live validation windows; switch to `auto` if fallback behavior is desired operationally.
## 0c) Latest Update (2026-06-04)
### 0.1 Problem summary addressed in this run
- Reported issue: propagation and downstream visibility were inconsistent across Gate Entry -> Gate Pass -> Gate Exit flow, specifically around Gate Entry availability in next-step dropdowns.
- Objective: stabilize list population in both processing screens and confirm end-to-end lifecycle behavior after deployment.
- Scope completed:
  - GatePass tile flow list refresh and filtering.
  - GateExit dropdown population for `PASS_ISSUED` entries.
  - Cloud Foundry deployment and runtime validation.
  - Final automated end-to-end verification.

### 0.2 Binding and piece-level integration details
- Gate Entry -> Gate Pass handoff (route query):
  - Source: `webapp/controller/GateEntryList.controller.js` (`navTo("GatePassList", { query: { gateEntryId, gateEntryNumber } })`).
  - Target consumption: `webapp/controller/GatePassList.controller.js` in `_prefillGateEntryFromRoute` + `_populateFromGateEntry`.
- GatePass tile navigation:
  - Source: `webapp/view/Dashboard.view.xml` tile custom data `route="GatePassList"`.
  - Trigger: `webapp/controller/Dashboard.controller.js` -> `onTilePress` -> router `navTo`.
- GatePass dropdown binding:
  - View: `webapp/view/GatePassList.view.xml` -> `items="{pass>/gateEntries}"`, key/text from `pass>ID`, `pass>gateEntryNumber`, etc.
  - Loader: `webapp/controller/GatePassList.controller.js` -> `_loadOpenGateEntries`.
- GateExit dropdown binding:
  - View: `webapp/view/GateExit.view.xml` -> `items="{exit>/passIssuedEntries}"`, key/text from `exit>ID`, `exit>gateEntryNumber`, etc.
  - Loader: `webapp/controller/GateExit.controller.js` -> `_loadPassIssuedEntries`.
- Backend status transitions:
  - GatePass creation: `srv/gatepass-service.js` -> `_onBeforeCreateGatePass` sets Gate Entry `entryStatus = PASS_ISSUED`.
  - GateExit close: `srv/gatepass-service.js` -> `_onCloseGateEntry` sets Gate Entry `entryStatus = EXITED`, `documentStatus = CLOSED`.

### 0.3 Fixes delivered in this run
- GateExit loader hardening (`webapp/controller/GateExit.controller.js`):
  - Added OData model refresh before load.
  - Switched to server-side filtered fetch with `$filter: "entryStatus eq 'PASS_ISSUED'"`.
- GatePass loader hardening (`webapp/controller/GatePassList.controller.js`):
  - Added OData model refresh before load.
  - Switched to server-side filtered fetch with `$filter: "entryStatus eq 'CREATED'"`.
  - Added post-save reload of open Gate Entries after Gate Pass creation.
- Propagation diagnostics:
  - Added structured `[GatePassPropagation]` logging in `_prefillGateEntryFromRoute` and `_populateFromGateEntry` for route/query, key selection, request path, and populate success/failure.

### 0.4 Troubleshooting milestones and verification evidence
1. Initial symptom validation:
   - Verified source routing and prefill code exists and is wired.
2. Runtime diagnosis:
   - Confirmed backend status transition works (`CREATED -> PASS_ISSUED`) when GatePass is created.
   - Identified list visibility inconsistency tied to stale/non-targeted client list loading patterns.
3. Fix implementation:
   - Applied server-filtered loading and refresh in GatePass/GateExit controllers.
4. Deployment:
   - Built and deployed MTAR to CF.
   - Deployment operation ID: `9f01ff67-600f-11f1-8898-eeee0a8e7579`.
5. CF runtime health:
   - `gatepass-srv` and `gatepass-app-router` started and healthy.
   - Required services present with successful operations.
6. Final end-to-end verification (automated):
   - Gate Entry created: `GE-000017`.
   - Gate Pass created: `GP-000008`.
   - GatePass propagation check: passed (`gatePassPrefill = true` with diagnostic logs).
   - GateExit dropdown inclusion check: passed (`gateExitDropdownContainsEntry = true`).
   - Close flow check: passed (`entryStatus = EXITED`, `documentStatus = CLOSED`).

### 0.5 Current state at handover
- Deployment is up-to-date on CF with current fixes.
- GatePass and GateExit flows are verified end-to-end in the latest run.
- Known deferred items from broader roadmap remain unchanged (ERP integration stubs, hard authorization validation, concurrency-safe numbering improvements).
## 0d) Previous Update (2026-05-09)
### 0.1 Recently completed fixes
- Stabilized app-router + HTML5 runtime access path and login flow for deployed app.
- Kept persistence on SQLite (HANA migration paused due missing entitlement in current landscape).
- Fixed Gate Entry create reliability:
  - UI now sends canonical EDM formats for date/time.
  - Backend normalizes localized/stale payload formats before validation (example: `5/9/26`, `12:55:54 AM`).
- Ensured generated Gate Entry Number visibility and propagation:
  - Gate Entry success popup shows `GE-XXXXXX`.
  - Added direct handoff action (`Open Gate Pass`) from Gate Entry create to Gate Pass processing with route query handoff.
- Fixed Gate Entry dropdown/list reliability in processing screens:
  - Explicit named-model bindings in ComboBox item templates (`pass>` / `exit>`).
  - Hardened list loading/filtering logic in Gate Pass and Gate Exit controllers.

### 0.2 Current verified state
- Local CAP API returns `GateEntries` correctly for `entryStatus = CREATED`.
- UI build passes with current code (`npm run build` successful).
- Gate Entry -> Gate Pass handoff is wired through route query params (`gateEntryId`, `gateEntryNumber`).

### 0.3 Immediate checks after pull/restart
1. Start backend: `npm run start:cap`
2. Start UI: `npm start`
3. Hard refresh browser (`Cmd+Shift+R`)
4. Validate:
   - Gate Entry create shows generated GE number.
   - Clicking **Open Gate Pass** preselects the same Gate Entry.
   - Gate Entry dropdown in Gate Pass screen shows available `CREATED` entries.

### 0.4 Pending operational follow-up
- Re-run live CF validation after fresh `cf login` (prior session token expired during final API/log verification step).
## 1) System Snapshot
- Frontend: SAPUI5 app in `webapp/` consuming OData V4 at `/gatepass/`.
- Backend: CAP data model and handlers in `db/` and `srv/`.
- Deployment/security descriptors: `mta.yaml`, `approuter/xs-app.json`, `xs-security.json`.
- Persistence profile in use: SQLite (HANA path paused due entitlement gap).
- Build artifacts commonly used: `gatepass-ui.zip`, `.mtar_tmp/gatepass_1.0.0.mtar`.

## 2) Runtime and Routing Map
### UI -> CAP
- `webapp/manifest.json` points `mainService` to `/gatepass/` (OData V4).
- `ui5.yaml` proxy maps `/gatepass` to `http://localhost:4004/gatepass` for local development.
### Service/data linkage
- `srv/gatepass-service.cds` projects entities from `db/schema.cds` (`com.mdasad.gatepass`).
- Main relationships: GateEntries <-> GatePasses, GateEntries <-> GateExit, GatePasses <-> GatePassItems.
### BTP route chain
- AppRouter forwards `/gatepass/*` to destination `gatepass-srv-api` -> `gatepass-srv`.
- HTML5 content is served via `html5-apps-repo-rt`.
- Authentication uses XSUAA role templates (Security/Warehouse/Admin).

## 3) Remaining Work Before Production
1. Replace ERP lookup stubs in `srv/gatepass-service.js` (`_fetchPODetails`, `_fetchSalesInvoiceDetails`).
2. Enforce/verify role-based authorization in CAP handlers.
3. Improve number generation for concurrent-write safety.
4. Complete and store repeatable smoke-test evidence in target landscape.

## 4) Deployment Runbook (Quick)
### 4.1 Prerequisites
- `cf` CLI authenticated and org/space targeted.
- MultiApps plugin available (`cf deploy`).
- `mbt` available.
- Quotas present for `xsuaa`, `destination`, `html5-apps-repo` (host/runtime).
### 4.2 Build
```bash
npm ci
npx cds build --production
npx mbt build -p=cf -t .mtar_tmp
```
### 4.3 Deploy
```bash
cf deploy .mtar_tmp/gatepass_1.0.0.mtar
```
### 4.4 Verify
```bash
cf apps
cf services
cf logs gatepass-srv --recent
cf logs gatepass-app-router --recent
```
### 4.5 Role setup
- Create role collections from `xs-security.json` templates.
- Assign Security, Warehouse, and Admin users.
- Validate expected allow/deny behavior per role.

## 5) Smoke Test Checklist
1. App opens via app-router URL and authenticates.
2. Gate Entry create succeeds and returns generated `GE-XXXXXX`.
3. Gate Pass create succeeds for created Gate Entry.
4. Gate Exit (`closeGateEntry`) updates lifecycle to `EXITED` / `CLOSED`.
5. `/gatepass/$metadata`, key reads/writes, and action/function calls behave as expected.
6. Negative checks pass (invalid transitions and unauthorized actions are blocked).

## 6) Troubleshooting Shortlist
1. Build fails -> inspect npm/cds/mbt output and rebuild.
2. Deploy fails -> inspect `cf deploy` operation logs and plan/quota availability.
3. 401/403 -> verify route auth, role collections, and XSUAA mapping.
4. 404/5xx -> verify destination URL, app-router routing rules, and runtime bindings.
5. Business logic errors -> inspect `gatepass-srv` logs and handler preconditions.

## 7) Rollback Guidance
1. Re-deploy the last known-good MTAR.
2. Re-check destination and app-router bindings.
3. Re-run minimal smoke path: app load -> Gate Entry create -> Gate Pass create.

## 8) Deployment Sign-Off Criteria
Deployment is complete only if all are true:
1. MTAR deployment completes cleanly for all modules/resources.
2. App loads via app-router with XSUAA login.
3. UI OData V4 operations run without recurring critical 4xx/5xx errors.
4. End-to-end lifecycle (Entry -> Pass -> Exit) passes.
5. Role behavior is validated (Security/Warehouse/Admin).
6. Recent logs are free of recurring critical errors.
