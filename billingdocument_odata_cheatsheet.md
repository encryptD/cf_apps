# Billing Document OData V4 Cheat Sheet
**(API_BILLINGDOCUMENT – for agent reference)**

**Service Root**
```
https://<host>/sap/opu/odata4/sap/api_billingdocument/srvd_a2x/sap/billingdocument/0001/
```

**Namespace**  
`com.sap.gateway.srvd_a2x.api_billingdocument.v0001`

---

## 1. EntitySets

| EntitySet                   | EntityType                      | Key                                               | Description        |
|-----------------------------|---------------------------------|---------------------------------------------------|--------------------|
| BillingDocument             | BillingDocument_Type            | BillingDocument                                   | Header             |
| BillingDocumentItem         | BillingDocumentItem_Type        | BillingDocument + BillingDocumentItem             | Items              |
| BillingDocumentPartner      | BillingDocumentPartner_Type     | BillingDocument + PartnerFunction                 | Header Partners    |
| BillingDocumentItemPartner  | BillingDocumentItemPartner_Type | BillingDocument + BillingDocumentItem + PartnerFunction | Item Partners |
| BillingDocumentText         | BillingDocumentText_Type        | BillingDocument + Language + LongTextID           | Header Texts       |
| BillingDocumentItemText     | BillingDocumentItemText_Type    | BillingDocument + BillingDocumentItem + Language + LongTextID | Item Texts |

---

## 2. Main Entity – BillingDocument (Header)

**Key**: `BillingDocument` (String, MaxLength 10)

### Important Properties

| Property                     | Type            | Notes / Label                    |
|-----------------------------|-----------------|----------------------------------|
| BillingDocument             | String(10)      | Key – Billing Document           |
| BillingDocumentType         | String(4)       | Billing Type                     |
| BillingDocumentDate         | Date            | Billing Date                     |
| BillingDocumentCategory     | String(1)       | Billing Category                 |
| SDDocumentCategory          | String(4)       | SD Document Category             |
| SalesOrganization           | String(4)       | Sales Organization               |
| DistributionChannel         | String(2)       | Distribution Channel             |
| Division                    | String(2)       | Division                         |
| CompanyCode                 | String(4)       | Company Code                     |
| SoldToParty                 | String(10)      | Sold-to Party                    |
| PayerParty                  | String(10)      | Payer                            |
| TotalNetAmount              | Decimal(15)     | Net Value                        |
| TotalTaxAmount              | Decimal(13)     | Tax Amount                       |
| TotalGrossAmount            | Decimal(15)     | Total Amount                     |
| TransactionCurrency         | String(3)       | Document Currency                |
| BillingDocumentIsCancelled  | Boolean         | Canceled                         |
| CancelledBillingDocument    | String(10)      | Canceled Bill. Doc.              |
| OverallBillingStatus        | String(1)       | Billing Status                   |
| AccountingPostingStatus     | String(1)       | Posting Status                   |
| CreationDate / CreationTime | Date / Time     | Created On                       |
| LastChangeDateTime          | DateTimeOffset  | Last Changed                     |
| **YY1_VehicleNo_BDH**       | String(100)     | **Custom – Vehicle No.**         |
| **YY1_Customer_Name_BDH**   | String(100)     | **Custom – Customer Name**       |

### Navigations
- `_Item` → Collection of BillingDocumentItem
- `_Partner` → Collection of BillingDocumentPartner
- `_Text` → Collection of BillingDocumentText
- `_PricingDocument` → PricingDocument (ContainsTarget)

---

## 3. BillingDocumentItem

**Key**: `BillingDocument` + `BillingDocumentItem`

### Important Properties

| Property                        | Type            | Notes / Label                      |
|--------------------------------|-----------------|------------------------------------|
| BillingDocumentItem            | String(6)       | Item number                        |
| Product                        | String(18)      | Material / Product                 |
| BillingDocumentItemText        | String(40)      | Item Description                   |
| Plant                          | String(4)       | Plant                              |
| StorageLocation                | String(4)       | Storage Location                   |
| BillingQuantity                | Decimal(13,3)   | Invoiced Quantity                  |
| BillingQuantityUnitSAPCode     | String(3)       | Sales Unit                         |
| NetAmount                      | Decimal(15)     | Net Value of Item                  |
| GrossAmount                    | Decimal(15)     | Gross Value                        |
| TaxAmount                      | Decimal(13)     | Tax Amount                         |
| TransactionCurrency            | String(3)       | Currency                           |
| ReferenceSDDocument            | String(10)      | Reference Document                 |
| ReferenceSDDocumentItem        | String(6)       | Reference Item                     |
| SalesDocument                  | String(10)      | Sales Document                     |
| SalesDocumentItem              | String(6)       | Sales Document Item                |
| Batch                          | String(10)      | Batch                              |
| ShippingPoint                  | String(4)       | Shipping Point                     |
| **YY1_TRANSPORTER2_GSTIN_BDI** | String(20)      | **Custom – Transporter GSTIN**     |

### Navigations
- `_BillingDocument` → Header
- `_ItemPartner` → Collection of Item Partners
- `_ItemText` → Collection of Item Texts

---

## 4. Useful Query Patterns

### Get single Billing Document with items + partners
```http
GET BillingDocument('90001234')?$expand=_Item,_Partner,_Text
```

### Deep expand (items + item partners)
```http
GET BillingDocument('90001234')?
  $expand=_Item($expand=_ItemPartner,_ItemText),_Partner
```

### Filter by Billing Date / Sold-to / Type
```http
GET BillingDocument?
  $filter=BillingDocumentDate eq 2026-08-01 and SoldToParty eq '1000123'
  &$select=BillingDocument,BillingDocumentType,TotalNetAmount,TransactionCurrency,YY1_VehicleNo_BDH
  &$expand=_Item($select=BillingDocumentItem,Product,BillingQuantity,NetAmount)
```

### Filter items by Plant / Material
```http
GET BillingDocumentItem?
  $filter=Plant eq 'WE01' and Product eq 'MAT-001'
  &$expand=_BillingDocument
```

### Select only custom fields + key info
```http
GET BillingDocument('90001234')?
  $select=BillingDocument,BillingDocumentDate,SoldToParty,YY1_VehicleNo_BDH,YY1_Customer_Name_BDH,TotalGrossAmount
  &$expand=_Item($select=BillingDocumentItem,Product,BillingQuantity,YY1_TRANSPORTER2_GSTIN_BDI)
```

---

## 5. Actions

| Action                 | Bound To                     | Purpose                           | Key Parameters          |
|------------------------|------------------------------|-----------------------------------|-------------------------|
| `CreateFromSDDocument` | Collection(BillingDocument)  | Create billing docs from SD docs  | `_Reference`, `_Control`|
| `PostToAccounting`     | BillingDocument              | Post to FI                        | (bound to document)     |
| `UpdatePrices`         | PricingDocument / Item       | Re-price                          | `PricingType`           |

### Example – Post to Accounting
```http
POST BillingDocument('90001234')/SAP__self.PostToAccounting
```

---

## 6. Agent Tips (Token Saving)

1. Always use `$select` + `$expand` – never fetch full payload.
2. Custom fields start with `YY1_` – include them only when needed.
3. For list screens prefer:
   ```
   $select=BillingDocument,BillingDocumentDate,SoldToParty,TotalNetAmount,TransactionCurrency,YY1_VehicleNo_BDH
   ```
4. Use `$filter` on `BillingDocumentDate`, `SoldToParty`, `BillingDocumentType`, `Plant`.
5. Navigation names are prefixed with `_` (`_Item`, `_Partner`, etc.).
6. Most properties are **Computed** (read-only). Do not try to PATCH them.
7. Prefer deep `$expand` over multiple sequential calls.

---

**File**: `billingdocument_odata_cheatsheet.md`  
**Generated for**: Developer / Warp Agent  
**Source**: API_BILLINGDOCUMENT metadata (OData V4)
