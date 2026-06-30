# Goods Receipt OData V4 Cheat Sheet (SSP Open Item Goods Receipt)

**Service**  
`A_SSPOpenItemGoodsReceipt` (com.sap.gateway.srvd_a2x.api_sspopenitmgoodsreceipt.v0001)

**Key EntitySet**  
`A_SSPOpenItemGoodsReceipt`

---

## 1. Main Entity – A_SSPOpenItemGoodsReceiptType

**Primary Key**  
`PurchaseRequisition`, `PurchaseOrder`, `PurchaseOrderItem`, `PurchaseRequisitionItem`

**Key Properties**

| Property                        | Type                  | Description |
|---------------------------------|-----------------------|-----------|
| PurchaseRequisition             | Edm.String (10)       | Purchase Requisition Number |
| PurchaseOrder                   | Edm.String (10)       | Purchasing Document Number |
| PurchaseOrderItem               | Edm.String (5)        | PO Item Number |
| PurchaseRequisitionItem         | Edm.String (5)        | Requisition Item Number |
| Plant                           | Edm.String (4)        | Plant |
| ReferenceDocumentPlant          | Edm.String (4)        | Reference Plant |
| DeliveredQuantity               | Edm.Decimal (13,3)    | Delivered Quantity |
| DeliveryStatus                  | Edm.Boolean           | Delivery Status |
| MaterialDocument                | Edm.String (10)       | Material Document Number |
| MaterialDocumentYear            | Edm.String (4)        | Material Document Year |
| DeliveryNote                    | Edm.String (16)       | Delivery Note |
| MaterialDocumentHeaderText      | Edm.String (25)       | Header Text |
| DocumentDate / PostingDate      | Edm.Date              | Document / Posting Date |
| PurchaseOrderQuantityUnit       | Edm.String (3)        | Order Unit |

**Navigation**  
No major navigation properties defined in this entity.

---

## 2. Action – PostGoodsReceipt (Bound Action)

**Purpose**  
Post Goods Receipt for open items.

**Input Parameters** (Collection of A_SSPOpenItemGoodsReceiptType + additional params)

- PURCHASEREQUISITION
- PURCHASEORDER
- PURCHASEORDERITEM
- PURCHASEREQUISITIONITEM
- DELIVEREDQUANTITY
- DELIVERYSTATUS
- DELIVERYNOTE
- MATERIALDOCUMENTHEADERTEXT
- DOCUMENTDATE
- POSTINGDATE
- Other optional fields (PURREQNSSPAUTHOR, etc.)

**Output** (MMPUR_S_GR_OUT ComplexType)

| Property               | Type           | Description |
|------------------------|----------------|-----------|
| PURCHASEREQUISITION    | Edm.String (10)| Purchase Requisition |
| PURCHASEORDER          | Edm.String (10)| Purchase Order |
| PURCHASEORDERITEM      | Edm.String (5) | PO Item |
| PURCHASEREQUISITIONITEM| Edm.String (5) | Requisition Item |
| MATERIALDOCUMENT       | Edm.String (10)| Material Document |
| MATERIALDOCUMENTYEAR   | Edm.String (4) | Material Document Year |

---

## 3. Common Query & Action Patterns

### Read Open Items
```http
GET .../A_SSPOpenItemGoodsReceipt?$filter=PurchaseOrder eq '4500012345'

### Post Goods Receipt (Action Call)
```http
POST .../A_SSPOpenItemGoodsReceipt/PostGoodsReceipt
Content-Type: application/json

{
  "PURCHASEREQUISITION": "0010001234",
  "PURCHASEORDER": "4500012345",
  "PURCHASEORDERITEM": "00010",
  "PURCHASEREQUISITIONITEM": "00010",
  "DELIVEREDQUANTITY": 10.000,
  "DELIVERYSTATUS": true,
  "DELIVERYNOTE": "DN123456",
  "MATERIALDOCUMENTHEADERTEXT": "GR via API",
  "DOCUMENTDATE": "2026-06-18",
  "POSTINGDATE": "2026-06-18"
}

## 4. Agent Best Practices

•  Use the PostGoodsReceipt action for posting GR.
•  Always validate DeliveredQuantity against open quantity.
•  Check SAP__Messages in responses for errors.
•  Filter by PurchaseOrder or PurchaseRequisition for targeted queries.
•  For bulk GR, pass a collection to the action.

Version: Based on full metadata (June 2026)
Last Updated: 2026-06-21
