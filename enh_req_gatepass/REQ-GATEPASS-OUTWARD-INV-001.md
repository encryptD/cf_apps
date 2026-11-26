# REQ-GATEPASS-OUTWARD-INV-001

**Title:** Outward Flow – Invoice Reference Integration (Gate Entry + Gate Pass)  
**Type:** Enhancement  
**Priority:** High  
**Status:** Open  
**Created:** 2026-08-10  
**Related:** Billing Document OData Cheatsheet (`billingdocument_odata_cheatsheet.md`)

---

## 1. Overview

Enable **Outward** movement in Gate Entry and Gate Pass using **Billing Document (Invoice)** as the reference document instead of Purchase Order.

All screens (Create / Change / Display / Cancel) must support the new outward invoice flow consistently.

---

## 2. Application Scope

| Application          | Scope of Change                                                                 |
|----------------------|---------------------------------------------------------------------------------|
| **Gate Entry**       | Outward mode – Reference section, field labels, tooltip, invoice fetch logic, item table columns |
| **Gate Pass**        | Reference Information section aligned with Gate Entry Outward; data mapped from local DB |
| **All Modes**        | Create, Change, Display, Cancel screens must reflect the same field labels and behaviour |
| **Backend (CAP)**    | New/extended schema to persist Invoice header + Invoice items (mirroring Inward pattern) |

---

## 3. Functional Requirements

### 3.1 Gate Entry – Outward Mode

#### 3.1.1 Reference Number Field
- Label remains **Reference Number** (or **Refe No** as currently shown).
- **Tooltip** must display:  
  > `Enter Inv No`
- Field is mandatory when Movement Type = Outward.

#### 3.1.2 Invoice Detail Fetching
- On entering / changing the Invoice Number (Billing Document), call the **Billing Document API** (see cheatsheet).
- Use the following mapping from `API_BILLINGDOCUMENT`:

| UI Field              | Source (Billing Document API)              | Notes                                      |
|-----------------------|--------------------------------------------|--------------------------------------------|
| Party Number          | `SoldToParty` (or `PayerParty` if required)| Renamed from Vendor Number                 |
| Party Name            | `YY1_Customer_Name_BDH`                    | Custom field – preferred                   |
| Vehicle Number        | `YY1_VehicleNo_BDH` (if available)         | Optional / if present on header            |
| Invoice Date          | `BillingDocumentDate`                      |                                            |
| Currency              | `TransactionCurrency`                      |                                            |
| Total Net / Gross     | `TotalNetAmount` / `TotalGrossAmount`      | Display only if needed                     |

- Expand `_Item` to load line items.

#### 3.1.3 Field Renames (All Screens)
| Old Label       | New Label      |
|-----------------|----------------|
| Vendor Number   | **Party Number** |
| Vendor Name     | **Party Name**   |

Apply the rename consistently in:
- Gate Entry Create / Change / Display / Cancel
- Gate Pass Create / Change / Display / Cancel

#### 3.1.4 Gate Entry / Gate Pass Item Table – Outward Columns

| Column              | Behaviour                                      |
|---------------------|------------------------------------------------|
| Item No             | Keep                                            |
| Material Code       | Keep (from `Product`)                           |
| Material Description| Keep (from `BillingDocumentItemText`)           |
| **Billed Qty**      | Replace “Order Quantity”. Source = `BillingQuantity` |
| Unit                | Keep (from `BillingQuantityUnitSAPCode`)        |
| **Challan Qty**     | **Remove** for Outward                          |
| **Plant**           | **Remove** for Outward                          |
| **Location**        | **Remove** for Outward                          |

> Note: Inward flow continues to show Order Qty, Challan Qty, Plant, Location as before.

---

### 3.2 Gate Pass – Reference Information Section

- The **Reference Information** section on Gate Pass must look and behave exactly like the Outward Reference section on Gate Entry.
- When a Gate Entry (Outward) is selected, all reference data (Invoice No, Party Number, Party Name, etc.) must be **fetched/mapped from the local DB** (not re-fetched from S/4 every time).
- User should see the same labels: Party Number, Party Name, etc.

---

## 4. Data Model / Schema Changes (CAP)

Create a structure parallel to the existing Inward (PO) flow for Outward (Invoice).

### 4.1 Proposed Entities

```cds
// Header – stores the Billing Document snapshot
entity InvoiceHeaders : managed {
  key ID                    : UUID;
      billingDocument       : String(10);          // Billing Document Number
      billingDocumentType   : String(4);
      billingDocumentDate   : Date;
      soldToParty           : String(10);          // Party Number
      partyName             : String(100);         // from YY1_Customer_Name_BDH
      vehicleNumber         : String(100);         // from YY1_VehicleNo_BDH
      transactionCurrency   : String(3);
      totalNetAmount        : Decimal(15,2);
      totalGrossAmount      : Decimal(15,2);
      totalTaxAmount        : Decimal(13,2);
      // link to Gate Entry if needed
      gateEntry             : Association to GateEntries;
}

// Items
entity InvoiceItems : managed {
  key ID                    : UUID;
      parent                : Association to InvoiceHeaders;
      billingDocumentItem   : String(6);
      product               : String(18);          // Material
      itemText              : String(40);
      billingQuantity       : Decimal(13,3);       // Billed Qty
      unit                  : String(3);
      netAmount             : Decimal(15,2);
      plant                 : String(4);           // store but do not show in Outward UI
      storageLocation       : String(4);           // store but do not show in Outward UI
}
```

### 4.2 Integration Points
- When Invoice is fetched successfully in Gate Entry (Outward) → persist header + items into the above entities (or equivalent existing tables if already designed for reference documents).
- Gate Pass must read Party Number, Party Name, Invoice Number, Billed Qty etc. from this local snapshot.

---

## 5. Technical Notes for Developer Agent

1. Use the cheatsheet: `billingdocument_odata_cheatsheet.md`
2. Preferred expand:
   ```
   BillingDocument('{InvNo}')?$expand=_Item
   &$select=BillingDocument,BillingDocumentDate,SoldToParty,YY1_Customer_Name_BDH,YY1_VehicleNo_BDH,TransactionCurrency,TotalNetAmount,TotalGrossAmount
   ```
3. Movement Type detection:
   - Inward  → PO flow (existing)
   - Outward → Invoice flow (this requirement)
4. Column visibility in Item table must be driven by Movement Type (expression binding or controller logic).
5. All renames must be done via i18n (do not hard-code labels).
6. Tooltip on Reference Number field only in Outward mode.

---

## 6. Acceptance Criteria

- [ ] In Gate Entry Outward, Reference Number field shows tooltip **“Enter Inv No”**
- [ ] Entering a valid Billing Document number fetches and displays Party Number & Party Name
- [ ] Vendor Number / Vendor Name labels are replaced by Party Number / Party Name on **all** screens (Create/Change/Display/Cancel)
- [ ] Item table in Outward shows **Billed Qty** and does **not** show Challan Qty, Plant, Location
- [ ] Invoice header + items are persisted in local DB (new or extended schema)
- [ ] Gate Pass Reference Information section matches Gate Entry Outward section and loads data from local DB
- [ ] Inward flow remains completely unchanged

---

## 7. Out of Scope

- Creation of Billing Documents from Gate Pass
- Posting of Goods Issue / PGI from this requirement
- Changes to Inward (PO) flow

---

**Document Owner:** Asad  
**For:** Developer / Warp Agent  
**Reference Cheatsheet:** `billingdocument_odata_cheatsheet.md`
