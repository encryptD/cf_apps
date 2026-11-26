# Change Request / Requirements Specification: GatePass Enhancements (CR-002 Clean Baseline)

**CR ID:** CR-002  
**Date:** July 9, 2026 (clean-pass revision)  
**Application Name:** GatePass (SAP BTP/CAP Application)  
**Priority:** High  
**Instruction Baseline:** Bill of Lading is explicitly excluded from this CR.

---

## 1. Purpose
This document replaces the duplicated CR text and defines a clean, implementation-ready CR-002 scope aligned to current direction.
It keeps previously delivered baseline features intact and defines only the delta requirements to implement next.

---

## 2. Explicit Exclusion
The following is **not** part of CR-002:
- Bill of Lading field in UI/data model.
- Any Bill of Lading mapping in S/4 Goods Receipt payload.

No requirement in this CR should reintroduce Bill of Lading.

---

## 3. Current Baseline (Already Available)
- Direct Gate Entry closure is supported from Gate Exit flow via `closeGateEntry`.
- Goods Receipt posting through S/4 Material Document API is available.
- Invoice Date and Invoice No. are mandatory in GatePass save flow.
- Unit auto-populates from PO line data and remains editable.
- Gate Entry dropdown in GatePass is sequenced and supports blank reset.

---

## 4. CR-002 In-Scope Requirements & Acceptance Criteria

### CR-002-REQ-01: Editable Exit Date and Exit Time
**Description:** Security users must be able to edit Exit Date and Exit Time before closing.
**Acceptance Criteria:**
- Exit Date and Exit Time controls are editable in Gate Exit.
- Future date/time is blocked with validation error.
- Saved values are written to `GateExit.exitDate` and `GateExit.exitTime`.
- Closing action uses user-entered exit timestamp (not forced current server timestamp).

### CR-002-REQ-02: Non-PO Closure UX Completion
**Description:** Non-PO closure must be available as an explicit operation in Gate Entry with confirmation and reason.
**Acceptance Criteria:**
- A dedicated “Close Entry” action is available in Gate Entry UI for eligible entries.
- User sees confirmation prompt before closure.
- Optional closure reason is captured and persisted.
- Status transition remains `CREATED -> EXITED` and document status to `CLOSED`.
- Closure must not require GatePass creation.

### CR-002-REQ-03: Batch Field Addition (Line Level)
**Description:** Add Batch at GatePass item level.
**Acceptance Criteria:**
- Batch field is available per line item in GatePass UI.
- Batch persists in backend data model (`GatePassItems` or aligned persisted payload structure).
- Existing flows continue to work when Batch is blank.

### CR-002-REQ-04: S/4 Goods Receipt Mapping (Bill of Lading Excluded)
**Description:** Map supported GatePass fields to S/4 GR payload.
**Acceptance Criteria:**
- Invoice No. maps to Delivery Note-equivalent field in GR payload.
- Remarks maps to header text field in GR payload.
- Batch maps to item-level batch field in GR payload.
- Mapping changes are implemented in `postGoodsReceipt` service logic.
- Mapping errors return controlled business error response.

### CR-002-REQ-05: Date of Manufacture to GR
**Description:** Date of Manufacture captured in GatePass must be sent to S/4 during GR posting.
**Acceptance Criteria:**
- Date of Manufacture field is captured and persisted.
- Payload mapping sends the value in expected S/4 date format (`YYYY-MM-DD` or service-compatible equivalent).
- Validation prevents invalid date values.

### CR-002-REQ-06: Gate Entry Number Format with Creation Date Suffix
**Description:** Generated Gate Entry number must include creation date suffix.
**Acceptance Criteria:**
- New format is `[sequence]-[YYYYMMDD]` (example: `GE-001005-20260709`).
- Implemented in Gate Entry create logic only for newly created entries.
- Existing Gate Entry numbers are unchanged.

---

## 5. Scope Guardrails for Implementation
- Do not add Bill of Lading field or mapping.
- Do not introduce unrelated schema/action changes outside REQ-01 to REQ-06.
- Keep OData V4 patterns and existing project conventions.

---

## 6. Impacted Areas (Expected)
- `webapp/view/GateExit.view.xml`
- `webapp/controller/GateExit.controller.js`
- `webapp/view/GateEntryList.view.xml`
- `webapp/controller/GateEntryList.controller.js`
- `webapp/view/GatePassList.view.xml`
- `webapp/controller/GatePassList.controller.js`
- `db/schema.cds`
- `srv/gatepass-service.cds`
- `srv/gatepass-service.js`
- `webapp/i18n/i18n.properties`
- `webapp/i18n/i18n_en.properties`

---

## 7. Notes
- This clean-pass CR-002 is the source of truth for future implementation.
- Any new requirement outside this scope should be captured as a separate CR delta.
