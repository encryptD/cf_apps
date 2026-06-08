using { managed, cuid } from '@sap/cds/common';

namespace com.mdasad.gatepass;

/**
 * Plant master data
 */
entity Plants : managed {
  key plantCode    : String(10) @title: 'Plant Code';
      plantName    : String(100) @title: 'Plant Name';
      location     : String(200) @title: 'Location';
      address      : String(250) @title: 'Address';
}

type MovementType : String enum {
  Inward  = 'I';
  Outward = 'O';
};

type DocumentStatus : String enum {
  Open       = 'OPEN';
  InProgress = 'IN_PROGRESS';
  Closed     = 'CLOSED';
  Cancelled  = 'CANCELLED';
};

type EntryStatus : String enum {
  Created     = 'CREATED';
  PassIssued  = 'PASS_ISSUED';
  Exited      = 'EXITED';
  Cancelled   = 'CANCELLED';
};

type ReferenceType : String enum {
  PurchaseOrder = 'PO';
  SalesInvoice  = 'SI';
};

/**
 * Gate Entry — registered by Security at plant gate
 */
entity GateEntries : managed, cuid {
  gateEntryNumber      : String(20) @title: 'Gate Entry Number';
  gateEntryYear        : Integer @title: 'Gate Entry Year';
  movementType         : MovementType not null @title: 'Movement Type';
  documentStatus       : DocumentStatus default 'OPEN' @title: 'Document Status';
  entryStatus          : EntryStatus default 'CREATED' @title: 'Entry Status';

  // Plant & Party (auto-fetched from PO/Invoice)
  plant                : String(10) @title: 'Plant';
  partyNumber          : String(20) @title: 'Party Number';
  partyName            : String(100) @title: 'Party Name';

  // Reference Document
  referenceType        : ReferenceType @title: 'Reference Type';
  referenceNumber      : String(20) @title: 'Reference Number';

  // Vehicle / Transporter
  vehicleNumber        : String(20) not null @title: 'Vehicle Number';
  vehicleType          : String(20) not null @title: 'Vehicle Type';
  transporterNumber    : String(20) @title: 'Transporter Number';
  transporterName      : String(100) not null @title: 'Transporter Name';
  driverName           : String(100) not null @title: 'Driver Name';
  driverContact        : String(20) @title: 'Driver Contact';
  lrNumber             : String(50) @title: 'LR Number';

  // Timestamps
  entryDate            : Date not null @title: 'Entry Date';
  entryTime            : Time @title: 'Entry Time';

  // Remarks
  remarks              : String(500) @title: 'Remarks';

  // Gate Pass form data saved against Gate Entry
  invoiceDate          : Date @title: 'Invoice Date';
  invoiceValue         : Decimal(15,2) @title: 'Invoice Value';
  eWayBillNumber       : String(50) @title: 'E-Way Bill Number';
  eWayBillDate         : Date @title: 'E-Way Bill Date';
  shippingAddress      : String(250) @title: 'Shipping Address';
  passDate             : Date @title: 'Pass Date';
  passTime             : Time @title: 'Pass Time';
  passRemarks          : String(500) @title: 'Pass Remarks';
  materialItemsJson    : LargeString @title: 'Material Items JSON';

  // Associations
  gatePasses           : Association to many GatePasses on gatePasses.gateEntry = $self;
  gateExit             : Association to GateExit on gateExit.gateEntry = $self;
};

/**
 * Gate Pass — created by Warehouse wrt Gate Entry
 */
entity GatePasses : managed, cuid {
  gatePassNumber       : String(20) @title: 'Gate Pass Number';
  movementType         : MovementType not null @title: 'Movement Type';
  documentStatus       : DocumentStatus default 'OPEN' @title: 'Document Status';

  // Link to Gate Entry
  gateEntry            : Association to GateEntries not null @title: 'Gate Entry';
  gateEntryNumber      : String(20) @title: 'Gate Entry Number';

  // Reference Document (copied/derived)
  referenceType        : String(10) @title: 'Reference Type';
  referenceNumber      : String(20) @title: 'Reference Number';
  invoiceDate          : Date @title: 'Invoice Date';
  invoiceValue         : Decimal(15,2) @title: 'Invoice Value';

  // Party
  partyNumber          : String(20) @title: 'Party Number';
  partyName            : String(100) @title: 'Party Name';

  // E-Way & Shipping
  eWayBillNumber       : String(50) @title: 'E-Way Bill Number';
  eWayBillDate         : Date @title: 'E-Way Bill Date';
  shippingAddress      : String(250) @title: 'Shipping Address';

  // Vehicle / Transporter (copied from Gate Entry, editable)
  vehicleNumber        : String(20) not null @title: 'Vehicle Number';
  vehicleType          : String(20) @title: 'Vehicle Type';
  transporterName      : String(100) @title: 'Transporter Name';
  driverName           : String(100) @title: 'Driver Name';
  lrNumber             : String(50) @title: 'LR Number';

  // Pass Timestamps
  passDate             : Date not null @title: 'Pass Date';
  passTime             : Time @title: 'Pass Time';

  // Remarks
  remarks              : String(500) @title: 'Remarks';


  // Line Items
  items                : Composition of many GatePassItems on items.gatePass = $self;
};

/**
 * Gate Pass Line Items — materials
 */
entity GatePassItems : managed, cuid {
  gatePass             : Association to GatePasses @title: 'Gate Pass';
  itemNumber           : Integer @title: 'Item Number';

  // Material
  materialCode         : String(40) not null @title: 'Material Code';
  materialDescription  : String(200) not null @title: 'Material Description';
  quantity             : Decimal(15,3) not null @title: 'Quantity';
  unitOfMeasure        : String(10) @title: 'Unit of Measure';

  // Supplier/Customer Invoice Details (per item)
  supplierInvoiceNo    : String(50) @title: 'Supplier Invoice No';
  supplierInvoiceDate  : Date @title: 'Supplier Invoice Date';

  // Reference to PO/Invoice item
  orderItemNumber      : String(10) @title: 'Order Item Number';
};

/**
 * Gate Exit — closure record created by Security at exit
 */
entity GateExit : managed, cuid {
  gateExitNumber       : String(20) @title: 'Gate Exit Number';

  // Link to Gate Entry
  gateEntry            : Association to GateEntries not null @title: 'Gate Entry';
  gateEntryNumber      : String(20) @title: 'Gate Entry Number';

  // Link to Gate Pass (the pass carried by vehicle operator)
  gatePass             : Association to GatePasses @title: 'Gate Pass';
  gatePassNumber       : String(20) @title: 'Gate Pass Number';

  // Exit Details
  exitDate             : Date not null @title: 'Exit Date';
  exitTime             : Time @title: 'Exit Time';

  // Security Officer
  securityOfficer      : String(100) @title: 'Security Officer';

  // Remarks
  remarks              : String(500) @title: 'Remarks';
};
