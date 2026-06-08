const cds = require('@sap/cds');

class GatePassService extends cds.ApplicationService {
  async init() {
    this.before('CREATE', 'GateEntries', this._onBeforeCreateGateEntry);
    this.before('UPDATE', 'GateEntries', this._onBeforeUpdateGateEntry);
    this.before('CREATE', 'GatePasses', (req) => req.error(400, 'GatePass record creation is disabled. Save data against Gate Entry only.'));
    this.before('UPDATE', 'GatePasses', this._onBeforeUpdateGatePass);
    this.on('closeGateEntry', this._onCloseGateEntry);
    this.on('saveGatePassData', this._onSaveGatePassData);
    this.on('printGatePass', this._onPrintGatePass);
    this.on('getPurchaseOrderDetails', this._onGetPurchaseOrderDetails);
    this.on('getSalesInvoiceDetails', this._onGetSalesInvoiceDetails);
    return super.init();
  }

  /**
   * Before CREATE Gate Entry — generate number, validate mandatory fields
   */
  async _onBeforeCreateGateEntry(req) {
    const { GateEntries } = this.entities;
    const data = req.data;

    // Normalize date/time payloads (supports localized UI values like 5/9/26, 12:10:28 AM)
    data.entryDate = this._normalizeDate(data.entryDate);
    data.entryTime = this._normalizeTime(data.entryTime);

    // Mandatory validations
    if (!data.movementType) {
      return req.error(400, 'Movement Type is mandatory');
    }
    if (!data.vehicleNumber) {
      return req.error(400, 'Vehicle Number is mandatory');
    }
    if (!data.vehicleType) {
      return req.error(400, 'Vehicle Type is mandatory');
    }
    if (!data.driverName) {
      return req.error(400, 'Driver Name is mandatory');
    }
    if (!data.transporterName) {
      return req.error(400, 'Transporter Name is mandatory');
    }
    if (!data.entryDate) {
      return req.error(400, 'Entry Date is mandatory');
    }

    // Set Gate Entry Year if not provided
    if (!data.gateEntryYear) {
      data.gateEntryYear = new Date().getFullYear();
    }

    // Generate Gate Entry Number (if not supplied by caller)
    if (!data.gateEntryNumber) {
      const last = await SELECT.one.from(GateEntries)
        .columns('gateEntryNumber')
        .where({ gateEntryNumber: { like: 'GE-%' } })
        .orderBy('gateEntryNumber desc');
      const lastSeq = last?.gateEntryNumber ? parseInt(last.gateEntryNumber.replace('GE-', ''), 10) : 0;
      const nextSeq = Number.isFinite(lastSeq) ? lastSeq + 1 : 1;
      data.gateEntryNumber = `GE-${String(nextSeq).padStart(6, '0')}`;
    }

    // Auto-populate from PO or Invoice
    if (data.movementType === 'I' && data.referenceType === 'PO' && data.referenceNumber) {
      const poDetails = await this._fetchPODetails(data.referenceNumber);
      if (poDetails) {
        data.plant = poDetails.plant || data.plant;
        data.partyNumber = poDetails.supplierNumber;
        data.partyName = poDetails.supplierName;
      }
    } else if (data.movementType === 'O' && data.referenceType === 'SI' && data.referenceNumber) {
      const siDetails = await this._fetchSalesInvoiceDetails(data.referenceNumber);
      if (siDetails) {
        data.plant = siDetails.plant || data.plant;
        data.partyNumber = siDetails.customerNumber;
        data.partyName = siDetails.customerName;
      }
    }
  }

  /**
   * Before UPDATE Gate Entry — prevent edit if already closed or exited
   */
  async _onBeforeUpdateGateEntry(req) {
    const { ID } = req.data;
    const entry = await SELECT.one.from(this.entities.GateEntries, ID).columns('entryStatus');
    if (entry && (entry.entryStatus === 'EXITED' || entry.entryStatus === 'CANCELLED')) {
      return req.error(400, 'Cannot modify a Gate Entry that is already exited or cancelled');
    }
  }

  /**
   * Action: Save GatePass form data against selected Gate Entry (no GatePass record creation)
   */
  async _onSaveGatePassData(req) {
    const { GateEntries } = this.entities;
    const data = req.data || {};

    // Mandatory validations
    if (!data.gateEntryID) {
      return req.error(400, 'Gate Entry is mandatory');
    }
    if (!data.vehicleNumber) {
      return req.error(400, 'Vehicle Number is mandatory');
    }
    if (!data.passDate) {
      return req.error(400, 'Pass Date is mandatory');
    }

    // Validate Gate Entry exists and is open
    const entry = await SELECT.one.from(GateEntries, data.gateEntryID).columns('*');
    if (!entry) {
      return req.error(404, 'Gate Entry not found');
    }
    if (entry.entryStatus === 'CANCELLED') {
      return req.error(400, 'Cannot save Gate Pass data for a cancelled Gate Entry');
    }
    if (entry.entryStatus === 'EXITED') {
      return req.error(400, 'Cannot save Gate Pass data for an exited Gate Entry');
    }

    // Normalize/sanitize incoming dates & times
    const sInvoiceDate = data.invoiceDate === '' ? null : this._normalizeDate(data.invoiceDate);
    const sEWayBillDate = data.eWayBillDate === '' ? null : this._normalizeDate(data.eWayBillDate);
    const sPassDate = this._normalizeDate(data.passDate);
    const sPassTime = this._normalizeTime(data.passTime);
    const nInvoiceValue = (data.invoiceValue !== null && data.invoiceValue !== undefined && data.invoiceValue !== '')
      ? Number(data.invoiceValue)
      : null;

    // Validate and normalize items JSON payload
    let sItemsJson = null;
    if (data.itemsJson) {
      try {
        const parsed = typeof data.itemsJson === 'string' ? JSON.parse(data.itemsJson) : data.itemsJson;
        sItemsJson = JSON.stringify(parsed || []);
      } catch (e) {
        return req.error(400, 'Material items payload is invalid');
      }
    }

    await UPDATE(GateEntries, entry.ID).set({
      vehicleNumber: data.vehicleNumber || entry.vehicleNumber,
      vehicleType: data.vehicleType || entry.vehicleType,
      transporterName: data.transporterName || entry.transporterName,
      driverName: data.driverName || entry.driverName,
      lrNumber: data.lrNumber || entry.lrNumber,
      invoiceDate: sInvoiceDate,
      invoiceValue: Number.isFinite(nInvoiceValue) ? nInvoiceValue : null,
      eWayBillNumber: data.eWayBillNumber || null,
      eWayBillDate: sEWayBillDate,
      shippingAddress: data.shippingAddress || null,
      passDate: sPassDate,
      passTime: sPassTime || null,
      passRemarks: data.remarks || null,
      materialItemsJson: sItemsJson,
      entryStatus: 'CREATED'
    });

    return SELECT.one.from(GateEntries, entry.ID);
  }

  /**
   * Before UPDATE Gate Pass
   */
  async _onBeforeUpdateGatePass(req) {
    const { ID } = req.data;
    const pass = await SELECT.one.from(this.entities.GatePasses, ID).columns('documentStatus');
    if (pass && pass.documentStatus === 'CLOSED') {
      return req.error(400, 'Cannot modify a closed Gate Pass');
    }
  }

  /**
   * Action: Close Gate Entry (Gate Exit)
   */
  async _onCloseGateEntry(req) {
    const { gateEntryID, gatePassID } = req.data;
    const { GateEntries, GateExit, GatePasses } = this.entities;

    // Validate Gate Entry
    const entry = await SELECT.one.from(GateEntries, gateEntryID);
    if (!entry) {
      return req.error(404, 'Gate Entry not found');
    }
    if (entry.entryStatus === 'EXITED') {
      return req.error(400, 'Gate Entry is already exited');
    }
    if (entry.entryStatus === 'CANCELLED') {
      return req.error(400, 'Gate Entry is cancelled');
    }
    if (entry.entryStatus !== 'CREATED' && entry.entryStatus !== 'PASS_ISSUED') {
      return req.error(400, 'Gate Entry is not open for exit');
    }

    // Validate optional Gate Pass if provided
    let pass = null;
    if (gatePassID) {
      pass = await SELECT.one.from(GatePasses, gatePassID);
      if (!pass) {
        return req.error(404, 'Gate Pass not found');
      }
      if (pass.gateEntry_ID !== gateEntryID) {
        return req.error(400, 'Gate Pass does not belong to this Gate Entry');
      }
    } else {
      pass = await SELECT.one.from(GatePasses).where({ gateEntry_ID: gateEntryID });
    }

    // Generate Gate Exit Number
    const count = await SELECT.from(GateExit).columns('count(*) as count');
    const seq = (count[0]?.count || 0) + 1;
    const gateExitNumber = `GX-${String(seq).padStart(6, '0')}`;

    // Create Gate Exit record
    const now = new Date();
    const oExitPayload = {
      gateExitNumber,
      gateEntry_ID: gateEntryID,
      gateEntryNumber: entry.gateEntryNumber,
      exitDate: now.toISOString().split('T')[0],
      exitTime: now.toTimeString().slice(0, 8),
      securityOfficer: req.user?.id || 'SYSTEM'
    };
    if (pass && pass.ID) {
      oExitPayload.gatePass_ID = pass.ID;
      oExitPayload.gatePassNumber = pass.gatePassNumber;
    }
    await INSERT.into(GateExit).entries(oExitPayload);

    // Update Gate Entry status
    await UPDATE(GateEntries, gateEntryID).set({
      entryStatus: 'EXITED',
      documentStatus: 'CLOSED'
    });

    // Return updated Gate Entry
    return SELECT.one.from(GateEntries, gateEntryID);
  }

  /**
   * Action: Print Gate Pass
   */
  async _onPrintGatePass(req) {
    const { gatePassID } = req.data;
    const { GatePasses, GatePassItems } = this.entities;

    const pass = await SELECT.one.from(GatePasses, gatePassID).columns('*');
    if (!pass) {
      return req.error(404, 'Gate Pass not found');
    }

    const items = await SELECT.from(GatePassItems).where({ gatePass_ID: gatePassID });

    // Build print content (JSON representation)
    const printData = {
      gatePassNumber: pass.gatePassNumber,
      movementType: pass.movementType === 'I' ? 'Inward' : 'Outward',
      gateEntryNumber: pass.gateEntryNumber,
      referenceNumber: pass.referenceNumber,
      partyName: pass.partyName,
      vehicleNumber: pass.vehicleNumber,
      vehicleType: pass.vehicleType,
      transporterName: pass.transporterName,
      driverName: pass.driverName,
      lrNumber: pass.lrNumber,
      eWayBillNumber: pass.eWayBillNumber,
      shippingAddress: pass.shippingAddress,
      passDate: pass.passDate,
      passTime: pass.passTime,
      remarks: pass.remarks,
      items: items.map(item => ({
        materialCode: item.materialCode,
        materialDescription: item.materialDescription,
        quantity: item.quantity,
        challanQuantity: item.challanQuantity,
        unitOfMeasure: item.unitOfMeasure
      }))
    };

    return JSON.stringify(printData, null, 2);
  }

  /**
   * Function: Get Purchase Order Details
   */
  async _onGetPurchaseOrderDetails(req) {
    const { poNumber } = req.data;
    return this._fetchPODetails(poNumber);
  }

  /**
   * Function: Get Sales Invoice Details
   */
  async _onGetSalesInvoiceDetails(req) {
    const { invoiceNumber } = req.data;
    // Stub: In real implementation, call SAP ERP / S/4HANA
    return {
      plant: '1000',
      customerNumber: `CUST-${invoiceNumber}`,
      customerName: `Customer for ${invoiceNumber}`
    };
  }

  // Helper: Fetch PO details with mock auto-fetch logic per Change Request
  async _fetchPODetails(poNumber) {
    const vendorNames = ['VEN-234', 'VEN-456', 'VEN-876'];
    const randomPlant = String(Math.floor(1000 + Math.random() * 9000)).padStart(4, '0');
    const randomVendorNo = String(Math.floor(1000000000 + Math.random() * 9000000000));
    const randomVendorName = vendorNames[Math.floor(Math.random() * vendorNames.length)];
    return {
      plant: randomPlant,
      supplierNumber: randomVendorNo,
      supplierName: randomVendorName
    };
  }

  // Helper: Fetch Sales Invoice details (stub for real ERP integration)
  async _fetchSalesInvoiceDetails(invoiceNumber) {
    // TODO: Replace with actual BAPI / OData call to SAP ERP
    return {
      plant: '1000',
      customerNumber: `CUST-${invoiceNumber}`,
      customerName: `Customer for ${invoiceNumber}`
    };
  }

  _normalizeDate(v) {
    if (!v) {
      return v;
    }
    if (v instanceof Date && !Number.isNaN(v.getTime())) {
      const y = v.getFullYear();
      const m = String(v.getMonth() + 1).padStart(2, '0');
      const d = String(v.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
    if (typeof v === 'string') {
      const s = v.trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
        return s;
      }
      const d = new Date(s);
      if (!Number.isNaN(d.getTime())) {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
      }
    }
    return v;
  }

  _normalizeTime(v) {
    if (!v) {
      return v;
    }
    if (v instanceof Date && !Number.isNaN(v.getTime())) {
      const h = String(v.getHours()).padStart(2, '0');
      const m = String(v.getMinutes()).padStart(2, '0');
      const s = String(v.getSeconds()).padStart(2, '0');
      return `${h}:${m}:${s}`;
    }
    if (typeof v === 'string') {
      const s = v.trim();
      let m = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
      if (m) {
        const hh = parseInt(m[1], 10);
        const mm = parseInt(m[2], 10);
        const ss = parseInt(m[3] || '0', 10);
        if (hh >= 0 && hh < 24 && mm >= 0 && mm < 60 && ss >= 0 && ss < 60) {
          return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
        }
      }
      m = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])$/);
      if (m) {
        let hh = parseInt(m[1], 10);
        const mm = parseInt(m[2], 10);
        const ss = parseInt(m[3] || '0', 10);
        const ap = m[4].toUpperCase();
        if (hh >= 1 && hh <= 12 && mm >= 0 && mm < 60 && ss >= 0 && ss < 60) {
          if (ap === 'PM' && hh !== 12) {
            hh += 12;
          } else if (ap === 'AM' && hh === 12) {
            hh = 0;
          }
          return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
        }
      }
    }
    return v;
  }
}

module.exports = GatePassService;
