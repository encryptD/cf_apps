# GatePass Handover and Deployment Finalization Runbook
## 0) Latest Update (2026-06-04)
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
## 0a) Previous Update (2026-05-09)
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
