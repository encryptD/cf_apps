# Enhancement Requirement: Without-PO PARKED Mode + Plant Field + Challan Qty Mandatory

**Requirement ID**: REQ-GATEPASS-ENH-004  
**Priority**: High  
**Status**: Draft  
**Date**: 2026-08-03  
**Owner**: Md Asad Uz Zaman  
**Target Audience**: Developer Agent  
**Related Project**: GatePass Application  

---

## 1. Background

Current GatePass application has limited support for Without-PO scenarios and does not fully control field behavior based on the presence of a Purchase Order.  

This enhancement introduces:
- A new **PARKED** lifecycle for Without-PO GatePasses
- Plant field at line-item level with dependent Location dropdown
- Change in quantity field mandatory behavior

---

## 2. Detailed Requirements

### 2.1 Without-PO GatePass in “PARKED” Mode

**Description**  
When a GatePass is created **without a Purchase Order**, it must be saved in status **“PARKED”**.

**Key Rules**:
- PARKED GatePasses must remain available in the GatePass selection dropdown **even after the Gate Exit process** has been completed.
- They should continue to appear in the dropdown until a **Goods Receipt (GR)** is posted against that PARKED GatePass.
- After successful GR, the GatePass must move to the normal post-GateExit status (same as existing PO-based flow).
- When a PARKED GatePass is selected/loaded:
  - All existing header fields must be loaded from the database.
  - All existing line items (including quantities, materials, etc.) must be fully loaded from the database.

**Application Scope**:  
- GatePass App (Create / Edit / Selection dropdown)  
- Gate Exit process  
- GR process integration

**Acceptance Criteria**:
- Without-PO GatePass is saved with status = `PARKED`.
- After Gate Exit, PARKED GatePasses still appear in the dropdown.
- After GR is posted, the GatePass no longer appears as PARKED and follows normal status flow.
- Loading a PARKED GatePass restores complete header + item data from DB.

---

### 2.2 Plant Field in GatePass Line Item

**Description**  
Add a new **Plant** field at the **line item level** of the GatePass.

**Behavior**:
- Plant dropdown must be populated from the **locally available plant-location master list** (ST LOC data).
- Location dropdown must be dynamically filtered based on the selected Plant (only locations belonging to that plant are shown).
- Plant field (and the dependent Location behavior) is available **only when no PO is entered**.
- Once a Purchase Order is entered → existing behavior must take over (Plant field becomes non-editable / hidden or follows current PO-driven logic).
- By default, no value is selected in the Plant dropdown.
- Plant field is **editable only in Without-PO scenarios**.

**Application Scope**:  
- GatePass Entry Form – Line Item section

**Acceptance Criteria**:
- Plant dropdown appears in line items when PO is blank.
- Selecting a Plant filters the Location dropdown correctly.
- Plant is editable only when the GatePass is Without-PO.
- When PO is entered, Plant field follows existing (PO-driven) behavior.
- Default state of Plant dropdown is empty (no value selected).

---

### 2.3 Challan Quantity Mandatory + Order Quantity Display Only

**Description**  
Change the quantity field behavior:

- **Challan Quantity** must become a **mandatory** field.
- **Order Quantity** must become **display-only** (read-only).

**Application Scope**:  
- GatePass Entry Form – Line Item section

**Acceptance Criteria**:
- User cannot save the GatePass if Challan Quantity is empty.
- Clear validation message is shown when Challan Quantity is missing.
- Order Quantity field is visible but not editable.
- Existing data for Order Quantity is still displayed correctly.

---

## 3. Technical Notes for Developer Agent

1. **Status Handling**  
   - Introduce / use status value `PARKED` for Without-PO GatePasses.
   - Update dropdown query logic so that PARKED GatePasses remain visible after Gate Exit until GR is completed.

2. **Plant & Location Master**  
   - Use the existing local plant-location list (from ST LOC.xlsx / JSON).
   - Implement dependent dropdown logic (Plant → Location).

3. **Field Control Logic**  
   - Plant field visibility/editability must be driven by presence/absence of PO.
   - Challan Quantity → `required: true`
   - Order Quantity → `editable: false` / `displayOnly: true`

4. **Data Loading**  
   - When loading a PARKED GatePass, ensure deep load of header + all items from the database.

---

## 4. Overall Acceptance Criteria

- All three points above are implemented and working together.
- No regression in existing PO-based GatePass flow.
- PARKED lifecycle works end-to-end (Create → Gate Exit → still visible → GR → normal status).
- Plant + Location dependent dropdown works correctly for Without-PO cases.
- Challan Quantity is mandatory and Order Quantity is display-only.

---

## 5. Implementation Priority

1. Status PARKED logic + dropdown visibility
2. Plant field + dependent Location dropdown
3. Challan Quantity mandatory + Order Quantity display-only

---

**Target Completion**: To be planned by Developer Agent  
**References**:  
- Previous GatePass requirements (REQ-GATEPASS-*)  
- Storage Location master data (ST LOC)  
- Existing GR integration logic
