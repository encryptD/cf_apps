# Goods Receipt OData V4 – Usage Examples

Use this together with the main [Goods Receipt Cheat Sheet](goods_receipt_odata_cheatsheet.md).

---

## 1. Read Open Items for a PO

```http
GET /A_SSPOpenItemGoodsReceipt?$filter=PurchaseOrder eq '4500012345'
&$select=PurchaseRequisition,PurchaseOrder,PurchaseOrderItem,DeliveredQuantity,DeliveryStatus

### Response Example (simplified)

{
  "value": [
    {
      "PurchaseRequisition": "0010001234",
      "PurchaseOrder": "4500012345",
      "PurchaseOrderItem": "00010",
      "DeliveredQuantity": 8.000,
      "DeliveryStatus": false
    }
  ]
}

## 2. Post Goods Receipt (Main Action)

POST /A_SSPOpenItemGoodsReceipt/PostGoodsReceipt
Content-Type: application/json

{
  "PURCHASEREQUISITION": "0010001234",
  "PURCHASEORDER": "4500012345",
  "PURCHASEORDERITEM": "00010",
  "PURCHASEREQUISITIONITEM": "00010",
  "DELIVEREDQUANTITY": 10.000,
  "DELIVERYSTATUS": true,
  "DELIVERYNOTE": "DN-20260621-001",
  "MATERIALDOCUMENTHEADERTEXT": "GR posted via API - June 2026",
  "DOCUMENTDATE": "2026-06-21",
  "POSTINGDATE": "2026-06-21"
}

### Success Response:

{
  "PURCHASEREQUISITION": "0010001234",
  "PURCHASEORDER": "4500012345",
  "PURCHASEORDERITEM": "00010",
  "PURCHASEREQUISITIONITEM": "00010",
  "MATERIALDOCUMENT": "4900005678",
  "MATERIALDOCUMENTYEAR": "2026"
}

## 3. JavaScript / Node.js Example (CAP or Fetch)

const grService = await cds.connect.to('A_SSPOpenItemGoodsReceipt');

const result = await grService.send({
  method: 'POST',
  path: 'PostGoodsReceipt',
  data: {
    PURCHASEREQUISITION: '0010001234',
    PURCHASEORDER: '4500012345',
    PURCHASEORDERITEM: '00010',
    PURCHASEREQUISITIONITEM: '00010',
    DELIVEREDQUANTITY: 15.000,
    DELIVERYSTATUS: true,
    DELIVERYNOTE: 'DN-TEST-001',
    MATERIALDOCUMENTHEADERTEXT: 'GR via Agent'
  }
});

## 4. UI5 / Fiori Elements Example (OData Model)

// In controller or extension
this.getView().getModel().callFunction("/PostGoodsReceipt", {
  method: "POST",
  urlParameters: {
    PURCHASEREQUISITION: "0010001234",
    PURCHASEORDER: "4500012345",
    // ... other params
  },
  success: function(oData) {
    MessageToast.show("GR Posted - Material Doc: " + oData.MATERIALDOCUMENT);
  }
});

## 5. AI Agent Prompt Template

Use the PostGoodsReceipt action on A_SSPOpenItemGoodsReceipt service.
Always validate open quantity first via GET on the entity set.
Return the MATERIALDOCUMENT number on success.
Handle SAP__Messages for errors.
