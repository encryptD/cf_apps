# Change Request / Requirements Specification: GatePass Enhancements (Aligned to Implemented Scope)

**CR ID:** CR-001  
**Date:** July 5, 2026 (aligned revision)  
**Application Name:** GatePass (SAP BTP/CAP Application)  
**Priority:** High  
**Alignment Rule:** This document is aligned strictly to functionality already developed and deployed. The Bill of Lading scope is excluded.

---

## 1. Implemented Scope Summary
The currently delivered scope includes:
- Direct closure of Gate Entry without mandatory Gate Pass linkage.
- Stabilized Goods Receipt posting using S/4 Material Document API with explicit CSRF token/cookie flow.
- Mandatory Invoice Date and Invoice No. validations in GatePass save flow (UI + backend).
- Auto-population of line-item Unit from PO data, while keeping the field editable.
- Gate Entry dropdown sequencing (numeric order) and blank entry behavior to reset GatePass form.
- Dashboard GatePass tile subtitle updated to `STORAGE DEPARTMENT`.

---

## 2. Detailed Requirements & Acceptance Criteria (As Implemented)

### CR-001-REQ-01: Gate Entry Direct Closure Support
**Description:** The system supports closure of a Gate Entry even when no Gate Pass is selected.
**Acceptance Criteria:**
- Close action is available from Gate Exit flow.
- `closeGateEntry` action accepts `gateEntryID` and optional `gatePassID`.
- If `gatePassID` is not provided, closure still proceeds.
- On successful close, `entryStatus` becomes `EXITED` and `documentStatus` becomes `CLOSED`.

### CR-001-REQ-02: Goods Receipt Integration Baseline
**Description:** Goods Receipt posting is executed through S/4 Material Document API with validated PO item payload.
**Acceptance Criteria:**
- Posting is restricted to Gate Entries linked to PO references.
- Payload includes PO item references, quantity, plant, storage location, and movement indicators required by API.
- CSRF token and cookie are explicitly fetched and reused for POST.
- Upstream authorization and business-validation errors are handled and surfaced via service-layer mapping.

### CR-001-REQ-03: Mandatory Invoice Fields in GatePass Save
**Description:** Invoice Date and Invoice No. are mandatory in GatePass data capture.
**Acceptance Criteria:**
- UI marks both fields as required.
- Client-side validation blocks save when either field is missing.
- Backend action `saveGatePassData` rejects requests with missing invoice date/no.

### CR-001-REQ-04: PO Unit Auto-Population for Material Items
**Description:** Line-item Unit is auto-derived from linked PO item data when available.
**Acceptance Criteria:**
- Unit is populated from PO snapshot/open-item fields during GatePass item population/backfill.
- Existing user-entered Unit values are not overwritten during backfill.
- Unit remains editable in UI.

### CR-001-REQ-05: Gate Entry Dropdown Ordering and Reset Behavior
**Description:** GatePass Gate Entry selector supports ordered listing and explicit reset.
**Acceptance Criteria:**
- Open Gate Entries are sorted sequentially by numeric portion of Gate Entry number.
- A blank first option is present in dropdown.
- Selecting blank option clears GatePass form context.

---

## 3. Explicit Exclusions from This Aligned Revision
The following items are excluded from this CR001-aligned scope and are not treated as implemented deliverables:
- Bill of Lading field addition and any related S/4 mapping.
- Batch field at GatePass line-item level and S/4 batch mapping.
- Date of Manufacture capture/mapping to S/4 Goods Receipt.
- Editable Exit Date/Time in Gate Exit screen (current implementation keeps these read-only and system-derived on close).
- Gate Entry Number format change to append creation date suffix.

---

## 4. Impacted Artifacts (Current Implemented Scope)
- `webapp/controller/GateExit.controller.js`
- `webapp/controller/GatePassList.controller.js`
- `webapp/view/GatePassList.view.xml`
- `webapp/view/Dashboard.view.xml`
- `webapp/i18n/i18n.properties`
- `srv/gatepass-service.js`

---

## 5. Notes
- This revision is intentionally constrained to current deployed behavior to avoid mismatch between requirement text and runtime implementation.
- Any excluded item should be raised as a new enhancement delta before development.
