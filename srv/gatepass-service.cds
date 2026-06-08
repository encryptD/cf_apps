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

  // Gate Exit — managed by Security
  @Capabilities: { Insertable: true, Updatable: false, Deletable: false }
  entity GateExit as projection on gp.GateExit {
    *,
    gateEntry : redirected to GateEntries,
    gatePass  : redirected to GatePasses
  };

  // Actions
  action closeGateEntry(gateEntryID: UUID, gatePassID: UUID) returns GateEntries;
  action saveGatePassData(
    gateEntryID: UUID,
    vehicleNumber: String,
    vehicleType: String,
    transporterName: String,
    driverName: String,
    lrNumber: String,
    invoiceDate: Date,
    invoiceValue: Decimal(15,2),
    eWayBillNumber: String,
    eWayBillDate: Date,
    shippingAddress: String,
    passDate: Date,
    passTime: Time,
    remarks: String,
    itemsJson: String(5000)
  ) returns GateEntries;
  action printGatePass(gatePassID: UUID) returns String;

  // Functions for lookups
  function getPurchaseOrderDetails(poNumber: String) returns {
    plant: String;
    supplierNumber: String;
    supplierName: String;
  };

  function getSalesInvoiceDetails(invoiceNumber: String) returns {
    plant: String;
    customerNumber: String;
    customerName: String;
  };
}
