# Change Request Specification: Mock Database Integration for Gate Entry App

**Document Version:** 1.1.0  
**Target System:** Gate Entry Application & Gate Pass Application  
**Objective:** Replace the previous random dummy-data generator logic with a structured local mock database. All relational fields on the "New Entry" screen must dynamically fetch, validate, and populate based on this structured dataset.

---

## 1. Mock Database Definition

The system must initialize and reference the following local JSON dataset as the single source of truth for Purchase Order (PO) operations:

```json
[
  {
    "po_no": "5100000338",
    "material_no": "MLRMIMAS0102HUI002",
    "material_description": "##Adhesive Sealant (JB)HT906Z",
    "po_qty": 10,
    "vendor": "5300000016",
    "vendor_name": "MAXWELL DISTRIBUTORS PVT LTD",
    "plant": "WE02",
    "item_no": 10
  },
  {
    "po_no": "5100000339",
    "material_no": "MLRMIMAS0102HUI002",
    "material_description": "##Adhesive Sealant (JB)HT906Z",
    "po_qty": 10,
    "vendor": "5300000016",
    "vendor_name": "MAXWELL DISTRIBUTORS PVT LTD",
    "plant": "WE02",
    "item_no": 10
  },
  {
    "po_no": "5100000339",
    "material_no": "1040000000020",
    "material_description": "3MM LONG ALLENKEY STANLEY",
    "po_qty": 20,
    "vendor": "5300000016",
    "vendor_name": "MAXWELL DISTRIBUTORS PVT LTD",
    "plant": "WE02",
    "item_no": 20
  }
]
```

---

## 2. Dynamic Field Cascading & UI Logic

To maintain relational integrity, the form fields on the "New Entry" screen must behave dynamically based on the user's selections.

### 2.1. Purchase Order Selection (`PO No`)
* **UI Component:** Dropdown / Searchable Select.
* **Options:** Populate dynamically with unique PO numbers from the mock database:
  * `5100000338`
  * `5100000339`

### 2.2. Line Item Selection (`Item No`)
* **Behavior:** Since a single PO can contain multiple line items (e.g., `5100000339` has items `10` and `20`), this field must dynamically filter based on the selected `PO No`.
* **Rules:**
  * If `PO No` = `5100000338`, the only available option is `10`.
  * If `PO No` = `5100000339`, the available options are `10` and `20`.
  * This field must remain disabled until a valid `PO No` is selected.

### 2.3. Dependent Auto-Fetched Fields
Once both a `PO No` and an `Item No` are selected, the application must immediately retrieve the corresponding record from the mock database and auto-populate the following read-only UI fields:

| UI Field Label | JSON Source Key | Field Property |
| :--- | :--- | :--- |
| **Vendor** | `vendor` | `Enabled: False` (Read-Only) |
| **Vendor Name** | `vendor_name` | `Enabled: False` (Read-Only) |
| **Plant** | `plant` | `Enabled: False` (Read-Only) |
| **Material No** | `material_no` | `Enabled: False` (Read-Only) |
| **Material Description** | `material_description` | `Enabled: False` (Read-Only) |
| **PO QTY** | `po_qty` | `Enabled: False` (Read-Only) |

---

## 3. Form Reset Behavior

* If the user changes or clears the selected `PO No`, all dependent fields (`Item No`, `Vendor`, `Vendor Name`, `Plant`, `Material No`, `Material Description`, `PO QTY`) must be reset to empty / null.
* The system should require re-selection of the `Item No` before re-populating the details.

---

## 4. Verification & Testing Instructions for Agents

* **Test Case 1 (Single Item PO):**
  1. Select PO Number `5100000338`.
  2. Verify that `Item No` dropdown displays only `10`.
  3. Select `10` and verify that `Vendor` displays `5300000016`, `Plant` displays `WE02`, and `PO QTY` displays `10`.

* **Test Case 2 (Multi-Item PO):**
  1. Select PO Number `5100000339`.
  2. Verify that `Item No` dropdown displays options `10` and `20`.
  3. Select `20`.
  4. Verify that `Material No` changes to `1040000000020`, `Material Description` changes to `3MM LONG ALLENKEY STANLEY`, and `PO QTY` updates to `20`.

* **Test Case 3 (Input Reset):**
  1. With a fully populated form from Test Case 2, clear the `PO No` field.
  2. Verify that all auto-fetched fields and the `Item No` selection return to their default empty states.
