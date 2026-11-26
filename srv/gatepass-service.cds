using { com.mdasad.gatepass as gp } from '../db/schema';

service GatePassService @(path: '/gatepass') {

  @readonly
  entity Plants as projection on gp.Plants;

  // Gate Entries — managed by Security
  @Capabilities: { Insertable: true, Updatable: true, Deletable: false }
  entity GateEntries as projection on gp.GateEntries {
    *,
    gatePasses : redirected to GatePasses,
    gateExit   : redirected to GateExit
  };

  // Gate Passes — managed by Warehouse
  @Capabilities: { Insertable: true, Updatable: true, Deletable: false }
  entity GatePasses as projection on gp.GatePasses {
    *,
    gateEntry : redirected to GateEntries,
    items     : redirected to GatePassItems
  };

  // Gate Pass Items
  @Capabilities: { Insertable: true, Updatable: true, Deletable: true }
  entity GatePassItems as projection on gp.GatePassItems {
    *,
    gatePass : redirected to GatePasses
  };

  // Outward Invoice snapshots
  @readonly
  entity InvoiceHeaders as projection on gp.InvoiceHeaders {
    *,
    gateEntry : redirected to GateEntries,
    items     : redirected to InvoiceItems
  };

  @readonly
  entity InvoiceItems as projection on gp.InvoiceItems {
    *,
    parent : redirected to InvoiceHeaders
  };

  // Gate Exit — managed by Security
  @Capabilities: { Insertable: true, Updatable: false, Deletable: false }
  entity GateExit as projection on gp.GateExit {
    *,
    gateEntry : redirected to GateEntries,
    gatePass  : redirected to GatePasses
  };

  // Actions
  action closeGateEntry(
    gateEntryID: UUID,
    gatePassID: UUID,
    exitDate: Date,
    exitTime: Time,
    clientTimezoneOffsetMinutes: Integer,
    securityOfficer: String,
    remarks: String
  ) returns GateEntries;
  action saveGatePassData(
    gateEntryID: UUID,
    referenceNumber: String(20),
    vehicleNumber: String,
    vehicleType: String,
    transporterName: String,
    driverName: String,
    lrNumber: String,
    invoiceDate: Date,
    invoiceValue: String(50),
    eWayBillNumber: String,
    eWayBillDate: Date,
    shippingAddress: String,
    passDate: Date,
    passTime: Time,
    remarks: String,
    itemsJson: String(15000)
  ) returns GateEntries;
  action printGatePass(gatePassID: UUID) returns String;
  action postGoodsReceipt(
    gateEntryID: UUID,
    poNumber: String,
    itemsJson: String(15000)
  ) returns {
    success: Boolean;
    materialDocument: String;
    materialDocumentYear: String;
    postedItems: Integer;
    message: String;
  };

  // Functions for lookups
  function getPurchaseOrderDetails(poNumber: String) returns {
    plant: String;
    supplierNumber: String;
    supplierName: String;
  };
  function getPurchaseOrderSnapshot(poNumber: String) returns {
    plant: String;
    supplierNumber: String;
    supplierName: String;
    itemsJson: String(15000);
  };
  function getGoodsReceiptOpenItems(poNumber: String) returns {
    itemsJson: String(15000);
  };

  function getSalesInvoiceDetails(invoiceNumber: String) returns {
    plant: String;
    customerNumber: String;
    customerName: String;
    vehicleNumber: String;
    transporterNumber: String;
    invoiceDate: Date;
    transactionCurrency: String;
    totalNetAmount: Decimal(15,2);
    totalGrossAmount: Decimal(15,2);
    itemsJson: String(15000);
  };

  // Read-only operational report rows (Gate Entry + Items + Gate Exit + GRN)
  function getGatePassReport() returns {
    rowsJson: LargeString;
  };
}
