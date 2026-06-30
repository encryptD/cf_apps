# Requirement: Enable Goods Receipt Button in GatePass App (SSP Open Item)
**Requirement ID**: REQ-GR-FIORI-002  
**Priority**: High  
**Status**: Reviewed (Clarified)  
**Date**: 2026-06-21  
**Owner**: Md Asad Uz Zaman  
## 1. Background
The GatePass screen contains a disabled **Goods Receipt** button. The target S/4 API (`A_SSPOpenItemGoodsReceipt`, action `PostGoodsReceipt`) is now available.
Current app architecture uses a single UI5 OData V4 model (`/gatepass/`) backed by CAP `GatePassService`. No direct UI model currently exists for `A_SSPOpenItemGoodsReceipt`.
## 2. Objective
Enable Goods Receipt posting from GatePass flow with proper validation, busy handling, and user feedback, while staying consistent with existing SAPUI5 + CAP OData V4 patterns.
## 3. Scope
### In Scope (Phase 1)
- GatePass app only.
- Activate Goods Receipt button behavior.
- Post GR for selected GatePass item(s) using S/4 action `PostGoodsReceipt` (multi-line supported in Phase 1).
- Client-side validation before posting.
- Success/error feedback with Material Document details.
- Refresh UI data after successful post.
- Server-side logging of posting attempts/outcomes.
### Out of Scope (Phase 1)
- New standalone GR screens.
- Workflow/approval redesign.
- Direct changes to S/4 OData API contract.
- Cross-PO bulk posting orchestration.
## 4. Architecture Decision (Adjusted for Current Project)
To align with current project setup:
- UI must call CAP `GatePassService` action (new backend wrapper), not call S/4 service directly from browser.
- CAP service (`srv/gatepass-service.js`) will invoke `A_SSPOpenItemGoodsReceipt/PostGoodsReceipt` using destination-based connectivity.
- UI continues using OData V4 patterns (`bindContext(...).setParameter(...).execute()`), no V2 APIs.
This avoids adding another frontend datasource/auth path and keeps credentials/destination handling backend-side.
## 5. References
- Main metadata reference: `goods_receipt_odata_cheatsheet.md`
- Usage examples: `goods_receipt_example.md`
Note: any V2-style sample (`callFunction`) is informational only. Implementation must follow OData V4 patterns used in this repo.
## 6. Functional Flow (Phase 1)
1. User opens GatePass and selects Gate Entry.
2. User selects one or more GatePass material line items eligible for GR.
3. Goods Receipt button becomes enabled only for valid selection.
4. On button press:
   - validate mandatory fields and quantity.
   - show loader.
   - call CAP action for GR posting.
5. On success:
   - show success message with `MATERIALDOCUMENT` and `MATERIALDOCUMENTYEAR`.
   - refresh GatePass/GateEntry data.
6. On failure:
   - show error from `SAP__Messages` (fallback to generic message).
7. Always clear loader at end.
## 7. Data Mapping (GatePass -> PostGoodsReceipt)
Minimum payload mapping for each selected line:
- `PURCHASEREQUISITION` <- source from open-item lookup / mapped line context.
- `PURCHASEORDER` <- `referenceNumber` (when `referenceType = 'PO'`).
- `PURCHASEORDERITEM` <- `orderItemNumber`.
- `PURCHASEREQUISITIONITEM` <- mapped requisition item from lookup context.
- `DELIVEREDQUANTITY` <- `challanQuantity`.
- `DELIVERYSTATUS` <- `true`.
- `DELIVERYNOTE` <- keep current behavior (no new business default introduced in this phase).
- `MATERIALDOCUMENTHEADERTEXT` <- keep current behavior (no new business default introduced in this phase).
- `DOCUMENTDATE`, `POSTINGDATE` <- current business date.
Additional fields (`ORDERQUANTITYUNIT`, `ORDERQUANTITYUNITISOCODE`, author/requestor fields) must be passed if backend/S4 requires them at runtime. Any returned backend/S4 error must be recorded in application logs for follow-up action/fix.
## 8. Validation Rules
- Button disabled when:
  - no eligible line selected.
  - `referenceType` is not PO.
  - required item identifiers are missing.
  - posting quantity is invalid (`<= 0` or non-numeric).
- Prevent duplicate click while request is in progress.
- For multi-select (Phase 1), all selected rows must belong to same PO and pass validation.
- Already posted lines must not be shown as selectable rows in Goods Receipt action context.
## 9. Acceptance Criteria
- Goods Receipt button is inactive by default and activates only for valid context.
- Posting succeeds via CAP wrapper and returns material document info.
- Busy indicator is visible during posting.
- Success/error messages are clear and actionable.
- List/form values are refreshed after successful posting.
- No regression in existing GatePass, GateEntry, GateExit flows.
- Implementation uses OData V4 APIs only.
## 10. Implementation Plan (Pre-Approved Direction)
1. UI:
   - bind button `enabled` + `press`.
   - add/select row eligibility logic.
   - add busy-state handling.
2. CAP:
   - add new action in `srv/gatepass-service.cds` for GR posting.
   - implement action handler in `srv/gatepass-service.js`.
   - map and validate payload, call remote S/4 action, normalize response/errors.
   - log request outcome for audit.
3. Refresh:
   - reload affected GatePass/GateEntry context after success.
4. Validation:
   - UI build + CAP build + MTAR build.
   - runtime test with real PO/open-item data.
## 11. Clarifications Confirmed
1. Posting mode in Phase 1: **multi-line approved**.
2. Quantity precedence: **use `challanQuantity`**.
3. Optional/extra action fields: **keep current behavior; do not introduce new defaults now**. Record returned errors for corrective actions.
4. Audit persistence: **application logs only**.
5. Idempotency visibility: **already posted lines should not be shown**.
## 12. Risks and Mitigations
- Risk: missing field mapping for required S/4 params  
  Mitigation: enforce backend validation and clear error contract.
- Risk: stale UI item snapshot vs backend reality  
  Mitigation: fetch latest context before posting and refresh after posting.
- Risk: auth/destination failures  
  Mitigation: reuse existing backend destination approach and classify upstream errors.
**Approval Required By**: Functional + Technical Lead  
**Test Data Needed**: PO/open-item set with known quantities and posting authorization.
