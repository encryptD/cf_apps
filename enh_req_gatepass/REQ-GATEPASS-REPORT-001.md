# REQ-GATEPASS-REPORT-001

**Title:** Gate Pass Operational Report  
**Type:** New Feature  
**Priority:** High  
**Status:** Open  
**Created:** 2026-10-28  
**Scope:** GatePass Application (Fiori Launchpad + CAP / S/4 Custom Business Objects)

---

## 1. Overview

Create a new **read-only operational report** that consolidates data from Gate Entry, Gate Pass and Gate Exit.

The report must be available as a **separate tile** on the Fiori Launchpad.

---

## 2. Application Scope

| Area                    | Scope |
|-------------------------|-------|
| Fiori Launchpad         | New dedicated tile |
| Report UI               | New Fiori List Report / Analytical List Page (or Smart Table) |
| Data Sources            | Gate Entry, Gate Pass, Gate Exit (existing apps / CBOs) |
| Persistence             | No new transactional data. Read-only view over existing entities |
| Modes                   | Display only |

---

## 3. Functional Requirements

### 3.1 Launchpad Tile
- Create a **new tile** on the Launchpad (separate from Gate Entry / Gate Pass / Gate Exit).
- Tile title: **Gate Pass Report** (or equivalent i18n key).
- Subtitle (optional): Operational Report
- Navigation target: the new report app / view.

### 3.2 Report Behaviour
- The report is **read-only**.
- It must list records by combining data from:
  - Gate Entry
  - Gate Pass
  - Gate Exit
- One row should represent a meaningful combination (preferably at Gate Pass Item / GRN level, or Gate Entry + Item level — confirm during implementation if multiple GRNs exist).
- Support standard List Report features:
  - Filtering
  - Sorting
  - Personalization
  - Export to Excel (recommended)
  - Search (if applicable)

### 3.3 Report Fields (Mandatory)

| #  | Report Field              | Source App / Entity          | Source Field (expected)                  | Notes |
|----|---------------------------|------------------------------|------------------------------------------|-------|
| 1  | Gate Entry Number         | Gate Entry                   | GateEntryNumber / gateEntryNumber        | |
| 2  | Gate Entry Date           | Gate Entry                   | entryDate                                | |
| 3  | Purchasing Doc. No        | Gate Entry / Gate Pass       | referenceNumber (when referenceType = PO)| |
| 4  | PO Item                   | Gate Pass Item               | orderItemNumber                          | |
| 5  | Plant                     | Gate Entry / Gate Pass Item  | plant                                    | |
| 6  | Material Number           | Gate Pass Item               | materialCode / product                   | |
| 7  | Material Description      | Gate Pass Item               | materialDescription / itemText           | |
| 8  | PO Quantity               | Gate Pass Item               | quantity                                 | Original PO qty |
| 9  | PO Unit                   | Gate Pass Item               | unitOfMeasure / unit                     | |
| 10 | Vendor Code               | Gate Entry / Gate Pass       | partyNumber                              | |
| 11 | Vendor Name               | Gate Entry / Gate Pass       | partyName                                | |
| 12 | Invoice No                | Gate Entry / Invoice Header  | invoice number / billingDocument         | |
| 13 | Invoice Date              | Gate Entry / Invoice Header  | invoiceDate / billingDocumentDate        | |
| 14 | Vehicle Number            | Gate Entry / Gate Pass       | vehicleNumber                            | |
| 15 | Vehicle Type              | Gate Entry / Gate Pass       | vehicleType                              | |
| 16 | Transport No              | Gate Entry                   | transporterNumber                        | |
| 17 | Transport Name            | Gate Entry / Gate Pass       | transporterName                          | |
| 18 | LR Number                 | Gate Entry / Gate Pass       | lrNumber                                 | |
| 19 | LR Date                   | —                            | (to be confirmed / derived if available) | |
| 20 | Challan Qty               | Gate Pass Item               | challanQuantity                          | |
| 21 | Balance Qty               | Calculated                   | PO Qty − GRN Qty (or open qty)           | |
| 22 | GRN No                    | Goods Receipt / GR process   | materialDocument / GRN number            | From GR posting |
| 23 | GRN Year                  | Goods Receipt                | materialDocumentYear                     | |
| 24 | GRN Posting Date          | Goods Receipt                | postingDate                              | |
| 25 | GRN Storage Loc           | Goods Receipt / Item         | storageLocation                          | |
| 26 | GRN Qty                   | Goods Receipt                | posted quantity                          | |
| 27 | Gate Entry Exit           | Gate Exit                    | gateExitNumber (or status indicator)     | |
| 28 | Gate Entry Exit Date      | Gate Exit                    | exitDate                                 | |

> **Note:** Exact field mapping must be validated against the current CAP model / S/4 Custom Business Objects (`YY1_ZGT_GATE_ENTRY`, `YY1_GATEPASS_DETAILS`, `YY1_GATEPASSITEMS` / `YY1_GATEPASS_ITEM`, `YY1_GATEEXIT`, and GR-related data).

---

## 4. Technical Notes for Developer Agent

### 4.1 Data Strategy (Recommended)
Prefer one of the following (choose the cleanest for the current architecture):

**Option A – CAP CDS View / Projection (Preferred)**
- Create a new CDS entity / view (e.g. `GatePassReport`) that joins:
  - GateEntries
  - GatePasses
  - GatePassItems
  - GateExits
  - Goods Receipt data (if stored locally or via association)
- Expose it as an OData entity for the report.

**Option B – Direct read from S/4 Custom Business Objects**
- If persistence has moved to `YY1_*` CBOs, build the report by reading from those services (via Destination) and joining in CAP or in a custom action.

### 4.2 UI
- Create a new Fiori app (or freestyle / List Report template) for the report.
- Use `sap.ui.comp.smarttable.SmartTable` or Fiori Elements List Report.
- Add the app to the Launchpad via FLP content / intent (separate semantic object + action).

### 4.3 Calculated Fields
- **Balance Qty** = PO Quantity − GRN Qty (handle nulls / multiple GRNs carefully).
- If multiple GRNs exist per item, decide whether to show one row per GRN or aggregate.

### 4.4 Performance
- Add appropriate `$select` and filtering.
- Consider pagination / growing table.
- Avoid deep expands on every load.

### 4.5 i18n
- All column labels must come from i18n (do not hard-code).

---

## 5. Acceptance Criteria

- [ ] A new tile “Gate Pass Report” appears on the Launchpad
- [ ] Clicking the tile opens the report
- [ ] The report displays all 28 fields listed above (or clearly documented deviations)
- [ ] Data is correctly joined from Gate Entry + Gate Pass + Gate Exit (+ GRN where available)
- [ ] Filtering and sorting work on key columns (Gate Entry Number, Plant, Vendor, Dates, etc.)
- [ ] Export to Excel works
- [ ] Report is read-only (no edit / delete actions)
- [ ] Balance Qty is calculated correctly
- [ ] Performance is acceptable for expected data volume

---

## 6. Out of Scope

- Editing any Gate Entry / Gate Pass / Gate Exit data from the report
- Creating new business documents
- Changes to existing Gate Entry / Gate Pass / Gate Exit apps (except if a field is missing and must be exposed)

---

## 7. Open Points (to be clarified during implementation)

1. Exact grain of the report (one row per Gate Pass Item vs one row per GRN).
2. Source of GRN data (local CAP entity vs S/4 Material Document / Outbound Delivery API).
3. Whether “LR Date” exists or needs to be added / left blank.
4. Handling of Without-PO / PARKED Gate Passes.
5. Handling of Outward (Invoice) vs Inward (PO) records.

---

**Document Owner:** Asad  
**For:** Developer / Warp Agent  
**Related:** GatePass CAP app, S/4 Custom Business Objects (`YY1_*`), previous REQ-GATEPASS-* documents
