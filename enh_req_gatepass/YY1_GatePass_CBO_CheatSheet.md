# YY1 GatePass Custom Business Objects – Agent Cheat Sheet

**Purpose:** Replace CAP / HANA Cloud / Postgres persistence with S/4HANA Custom Business Objects (CBOs).  
**System:** S/4HANA Public Cloud (`my410644`)  
**OData Version:** V2 (Custom Business Object style)  
**Generated:** 2026-08-26

---

## 1. Service Endpoints Overview

| CBO Technical Name              | Entity Set Name              | Full URL |
|---------------------------------|------------------------------|----------|
| YY1_ZGT_GATE_ENTRY              | YY1_ZGT_GATE_ENTRY           | `/sap/opu/odata/sap/YY1_ZGT_GATE_ENTRY_CDS/YY1_ZGT_GATE_ENTRY` |
| YY1_GATEPASS_DETAILS            | YY1_GATEPASS_DETAILS         | `/sap/opu/odata/sap/YY1_GATEPASS_DETAILS_CDS/YY1_GATEPASS_DETAILS` |
| YY1_GATEPASSITEMS               | YY1_GATEPASSITEMS            | `/sap/opu/odata/sap/YY1_GATEPASSITEMS_CDS/YY1_GATEPASSITEMS` |
| YY1_GATEPASS_ITEM               | YY1_GATEPASS_ITEM            | `/sap/opu/odata/sap/YY1_GATEPASS_ITEM_CDS/YY1_GATEPASS_ITEM` |
| YY1_GATEEXIT                    | YY1_GATEEXIT                 | `/sap/opu/odata/sap/YY1_GATEEXIT_CDS/YY1_GATEEXIT` |
| YY1_GATEPASS_INVOICEHEADER      | YY1_GATEPASS_INVOICEHEADER   | `/sap/opu/odata/sap/YY1_GATEPASS_INVOICEHEADER_CDS/YY1_GATEPASS_INVOICEHEADER` |
| YY1_GATEPASS_PLANTS             | YY1_GATEPASS_PLANTS          | `/sap/opu/odata/sap/YY1_GATEPASS_PLANTS_CDS/YY1_GATEPASS_PLANTS` |

**Base URL pattern:**
```
https://my410644-api.s4hana.cloud.sap/sap/opu/odata/sap/<CBO>_CDS/<ENTITY>
```

---

## 2. Gate Entry – `YY1_ZGT_GATE_ENTRY`

**Key:** `ID` (UUID)

### Important Properties
| Property              | Type / Format          | Notes |
|-----------------------|------------------------|-------|
| ID                    | UUID / String          | Primary Key |
| GateEntryNumber       | String                 | Business key (e.g. GE000001) |
| gateEntryYear         | String                 | Year |
| movementType          | String                 | `IN` / `OUT` |
| documentStatus        | String                 | e.g. OPEN |
| entryStatus           | String                 | e.g. ENTERED, CREATED |
| plant                 | String(4)              | |
| partyNumber           | String                 | |
| partyName             | String                 | |
| referenceType         | String                 | `PO` / Invoice etc. |
| referenceNumber       | String                 | |
| vehicleNumber         | String                 | |
| vehicleType           | String                 | |
| transporterName       | String                 | |
| transporterNumber     | String                 | |
| driverName            | String                 | |
| driverContact         | String                 | |
| lrNumber              | String                 | |
| entryDate             | `/Date(ms)/`           | |
| entryTime             | `PTxxHxxMxxS`          | Duration format |
| invoiceDate           | `/Date(ms)/`           | |
| invoiceValue_V        | Decimal                | Amount |
| invoiceValue_C        | String(3)              | Currency |
| eWayBillNumber        | String                 | |
| eWayBillDate          | `/Date(ms)/`           | |
| shippingAddress       | String                 | |
| passDate / passTime   | Date / Duration        | |
| passRemarks           | String                 | |
| materialItemsJson     | String                 | JSON array of items (legacy style) |
| remarks               | String                 | |
| SAP_Description       | String                 | |

### POST Example
```http
POST /sap/opu/odata/sap/YY1_ZGT_GATE_ENTRY_CDS/YY1_ZGT_GATE_ENTRY
Content-Type: application/json

{
  "ID": "8b7c6d5e-4f3a-4210-9876-123456789abc",
  "GateEntryNumber": "GE000001",
  "gateEntryYear": "2026",
  "movementType": "IN",
  "documentStatus": "OPEN",
  "entryStatus": "ENTERED",
  "plant": "1000",
  "partyNumber": "10000001",
  "partyName": "ABC Supplier",
  "referenceType": "PO",
  "referenceNumber": "4500001234",
  "vehicleNumber": "WB12AB1234",
  "vehicleType": "TRUCK",
  "transporterName": "ABC Transport",
  "driverName": "Ramesh Kumar",
  "driverContact": "9876543210",
  "lrNumber": "LR123456",
  "entryDate": "/Date(1756076400000)/",
  "entryTime": "PT10H30M00S",
  "invoiceDate": "/Date(1756076400000)/",
  "invoiceValue_V": "118000.000",
  "invoiceValue_C": "INR",
  "eWayBillNumber": "EWB123456789",
  "eWayBillDate": "/Date(1756076400000)/",
  "shippingAddress": "Kolkata, West Bengal",
  "passDate": "/Date(1756076400000)/",
  "passTime": "PT11H00M00S",
  "passRemarks": "Gate pass generated",
  "materialItemsJson": "[{\"po\":\"4500001234\",\"item\":\"00010\",\"material\":\"MAT001\",\"qty\":10,\"unit\":\"EA\"}]",
  "remarks": "Material received at main gate",
  "SAP_Description": "Gate Entry for PO Material"
}
```

### Useful Queries
```http
# Get by business number
GET YY1_ZGT_GATE_ENTRY?$filter=GateEntryNumber eq 'GE000001'

# Open entries only
GET YY1_ZGT_GATE_ENTRY?$filter=entryStatus eq 'ENTERED' or entryStatus eq 'CREATED'

# By plant + movement type
GET YY1_ZGT_GATE_ENTRY?$filter=plant eq '1000' and movementType eq 'IN'
&$select=ID,GateEntryNumber,partyNumber,partyName,referenceNumber,vehicleNumber,entryDate,entryStatus

# By reference (PO / Invoice)
GET YY1_ZGT_GATE_ENTRY?$filter=referenceType eq 'PO' and referenceNumber eq '4500001234'
```

---

## 3. Gate Pass Header – `YY1_GATEPASS_DETAILS`

**Key:** `ID`

### Important Properties
| Property            | Notes |
|---------------------|-------|
| ID                  | Primary Key |
| gatepassNumber      | Business number |
| movementType        | IN / OUT |
| documentStatus      | OPEN etc. |
| gateEntry_ID        | Link to Gate Entry |
| gateEntryNumber     | |
| referenceType       | PO / Invoice |
| referenceNumber     | |
| partyNumber / partyName | |
| invoiceDate / invoiceValue | |
| eWayBillNumber / eWayBillDate | |
| vehicle* / transporter* / driver* / lrNumber | |
| passDate / passTime | |
| shippingAddress / remarks | |
| SAP_Description     | |

### POST Example
```json
{
  "ID": "GP000001",
  "gatepassNumber": "GP-2026-000001",
  "movementType": "OUT",
  "documentStatus": "OPEN",
  "gateEntry_ID": "GE000001",
  "gateEntryNumber": "GE-2026-000001",
  "referenceType": "PO",
  "referenceNumber": "4500001234",
  "invoiceDate": "/Date(1755993600000)/",
  "invoiceValue": "100000.00",
  "partyNumber": "1000001",
  "partyName": "ABC SUPPLIERS PVT LTD",
  "eWayBillNumber": "EWB123456789",
  "eWayBillDate": "/Date(1755993600000)/",
  "shippingAddress": "Kolkata, West Bengal, India",
  "vehicleNumber": "WB12AB1234",
  "vehicleType": "TRUCK",
  "transporterName": "ABC TRANSPORT",
  "driverName": "RAHUL KUMAR",
  "lrNumber": "LR123456",
  "passDate": "/Date(1755993600000)/",
  "passTime": "PT14H30M00S",
  "remarks": "Gatepass created for PO dispatch",
  "SAP_Description": "Gatepass Details"
}
```

### Useful Queries
```http
GET YY1_GATEPASS_DETAILS?$filter=gatepassNumber eq 'GP-2026-000001'
GET YY1_GATEPASS_DETAILS?$filter=gateEntry_ID eq 'GE000001'
GET YY1_GATEPASS_DETAILS?$filter=documentStatus eq 'OPEN' and movementType eq 'OUT'
GET YY1_GATEPASS_DETAILS?$filter=referenceNumber eq '4500001234'
&$select=ID,gatepassNumber,partyNumber,partyName,vehicleNumber,passDate,documentStatus
```

---

## 4. Gate Pass Items

There are **two** item CBOs. Use the one that matches your final design.

### 4.1 `YY1_GATEPASSITEMS`
```http
POST /sap/opu/odata/sap/YY1_GATEPASSITEMS_CDS/YY1_GATEPASSITEMS
```
```json
{
  "ID": "GPI-000006",
  "gatePass_ID": "GP-000001",
  "SAP_Description": "Gate Pass Item 1",
  "quantity": "100.000",
  "materialCode": "MAT-100001",
  "materialDescription": "Test Material",
  "challanQuantity": "95.000",
  "unitOfMeasure": "EA",
  "batch": "BATCH001",
  "dateOfManufacture": "/Date(1756080000000)/",
  "plant": "1000",
  "orderItemNumber": "00010"
}
```

### 4.2 `YY1_GATEPASS_ITEM` (Outward / Invoice oriented)
```http
POST /sap/opu/odata/sap/YY1_GATEPASS_ITEM_CDS/YY1_GATEPASS_ITEM
```
```json
{
  "ID": "GPITEM000001",
  "parent_ID": "GP000001",
  "billingDocumentItem": "000010",
  "product": "MAT001",
  "itemText": "Gate Pass Item",
  "billingQuantity": "10.000",
  "unit": "EA",
  "netAmount": "1000.00",
  "plant": "1000",
  "storageLocation": "0001",
  "SAP_Description": "Gate Pass Item Description"
}
```

### Useful Queries (Items)
```http
# Items of a Gate Pass
GET YY1_GATEPASSITEMS?$filter=gatePass_ID eq 'GP-000001'
GET YY1_GATEPASS_ITEM?$filter=parent_ID eq 'GP000001'

# By material
GET YY1_GATEPASSITEMS?$filter=materialCode eq 'MAT-100001'
```

---

## 5. Gate Exit – `YY1_GATEEXIT`

```http
POST /sap/opu/odata/sap/YY1_GATEEXIT_CDS/YY1_GATEEXIT
```
```json
{
  "ID": "GE-000001",
  "gateEntry_ID": "GE001",
  "SAP_Description": "Gate Exit for Gate Entry GE001",
  "gateExitNumber": "GX000001",
  "gateEntryNumber": "GE001",
  "gatePass_ID": "GP000001",
  "gatePassNumber": "GP000001",
  "exitDate": "/Date(1756080000000)/",
  "exitTime": "PT16H30M00S",
  "securityOfficer": "Security Officer",
  "remarks": "Material exited from premises"
}
```

### Useful Queries
```http
GET YY1_GATEEXIT?$filter=gateEntry_ID eq 'GE001'
GET YY1_GATEEXIT?$filter=gatePassNumber eq 'GP000001'
GET YY1_GATEEXIT?$filter=exitDate ge datetime'2026-08-01T00:00:00'
```

---

## 6. Invoice Header (Outward) – `YY1_GATEPASS_INVOICEHEADER`

```http
POST /sap/opu/odata/sap/YY1_GATEPASS_INVOICEHEADER_CDS/YY1_GATEPASS_INVOICEHEADER
```
```json
{
  "ID": "INVHDR000001",
  "billingDocument": "9000001234",
  "billingDocumentType": "F2",
  "billingDocumentDate": "/Date(1755993600000)/",
  "soldToParty": "1000001000",
  "payerParty": "1000001000",
  "partyNumber": "1000001000",
  "partyName": "ABC CUSTOMER PVT LTD",
  "vehicleNumber": "WB12AB1234",
  "transactionCurrency": "INR",
  "totalNetAmount": "100000.00",
  "totalGrossAmount": "118000.00",
  "totalTaxAmount": "18000.00",
  "gateEntry_ID": "GE000001",
  "SAP_Description": "Gatepass Invoice Header"
}
```

### Useful Queries
```http
GET YY1_GATEPASS_INVOICEHEADER?$filter=billingDocument eq '9000001234'
GET YY1_GATEPASS_INVOICEHEADER?$filter=gateEntry_ID eq 'GE000001'
GET YY1_GATEPASS_INVOICEHEADER?$filter=partyNumber eq '1000001000'
```

---

## 7. Plants Master – `YY1_GATEPASS_PLANTS`

```http
POST /sap/opu/odata/sap/YY1_GATEPASS_PLANTS_CDS/YY1_GATEPASS_PLANTS
```
```json
{
  "plantCode": "1000",
  "plantName": "Main Plant",
  "location": "Kolkata",
  "address": "Kolkata, West Bengal, India",
  "SAP_Description": "Main Plant"
}
```

```http
GET YY1_GATEPASS_PLANTS?$filter=plantCode eq '1000'
GET YY1_GATEPASS_PLANTS  # full list for dropdown
```

---

## 8. Agent Implementation Guidelines

### Date & Time Handling
- **Date** → `/Date(millisecondsSinceEpoch)/`
- **Time** → `PTxxHxxMxxS` (ISO 8601 duration)

### CSRF & Headers (OData V2)
```http
GET .../$metadata          # or any GET first to obtain CSRF token
X-CSRF-Token: Fetch

Then on POST/PATCH/DELETE:
X-CSRF-Token: <token>
Content-Type: application/json
Accept: application/json
```

### Recommended Replacement Strategy
1. Keep the existing CAP service layer for business logic.
2. Replace the database persistence (SQLite / HANA Cloud / Postgres) with calls to these YY1_* CBOs.
3. Use Destination `S4HANA_PUBLIC` (or whatever you configured) pointing to `my410644-api.s4hana.cloud.sap`.
4. Map CAP entity fields ↔ CBO properties carefully (especially `GateEntryNumber` vs `gateEntryNumber` casing).
5. For list screens always use `$select` + `$filter` to keep payload small.
6. Prefer business keys (`GateEntryNumber`, `gatepassNumber`) for user-facing lookups; use `ID` for technical associations.

### Common Filters Agents Should Use
```http
$filter=entryStatus eq 'CREATED'
$filter=documentStatus eq 'OPEN'
$filter=movementType eq 'IN'
$filter=plant eq '1000'
$filter=referenceNumber eq '4500001234'
$filter=gateEntry_ID eq '...'
```

---

**File:** `YY1_GatePass_CBO_CheatSheet.md`  
**For:** Developer / Warp Agent  
**Next Step:** Point the CAP service to these OData endpoints instead of the local DB.
