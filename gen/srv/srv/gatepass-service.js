const cds = require('@sap/cds');
const aPOMockData = require('./mock/po-mock-data.json');

class GatePassService extends cds.ApplicationService {
  async init() {
    this._harmonizeS4Destinations();
    this.before('CREATE', 'GateEntries', this._onBeforeCreateGateEntry);
    this.before('UPDATE', 'GateEntries', this._onBeforeUpdateGateEntry);
    this.before('CREATE', 'GatePasses', (req) => req.error(400, 'GatePass record creation is disabled. Save data against Gate Entry only.'));
    this.before('UPDATE', 'GatePasses', this._onBeforeUpdateGatePass);
    this.on('closeGateEntry', this._onCloseGateEntry);
    this.on('saveGatePassData', this._onSaveGatePassData);
    this.on('printGatePass', this._onPrintGatePass);
    this.on('postGoodsReceipt', this._onPostGoodsReceipt);
    this.on('getPurchaseOrderDetails', this._onGetPurchaseOrderDetails);
    this.on('getPurchaseOrderSnapshot', this._onGetPurchaseOrderSnapshot);
    this.on('getGoodsReceiptOpenItems', this._onGetGoodsReceiptOpenItems);
    this.on('getSalesInvoiceDetails', this._onGetSalesInvoiceDetails);
    return super.init();
  }

  _readDestinationOverrideFromCDSConfig() {
    const sRaw = process.env.CDS_CONFIG;
    if (!sRaw) {
      return { po: '', gr: '' };
    }
    try {
      const oCfg = JSON.parse(sRaw);
      return {
        po: (((oCfg || {}).requires || {}).purchaseorder_api || {}).credentials?.destination || '',
        gr: (((oCfg || {}).requires || {}).goodsreceipt_api || {}).credentials?.destination || ''
      };
    } catch (e) {
      cds.log('gatepass-s4').warn(`Could not parse CDS_CONFIG for destination harmonization: ${e.message}`);
      return { po: '', gr: '' };
    }
  }

  _harmonizeS4Destinations() {
    const oRequires = cds.env?.requires || {};
    oRequires.purchaseorder_api = oRequires.purchaseorder_api || { kind: 'odata-v4', credentials: {} };
    oRequires.purchaseorder_api.credentials = oRequires.purchaseorder_api.credentials || {};
    oRequires.goodsreceipt_api = oRequires.goodsreceipt_api || { kind: 'odata-v4', credentials: {} };
    oRequires.goodsreceipt_api.credentials = oRequires.goodsreceipt_api.credentials || {};

    const oOverride = this._readDestinationOverrideFromCDSConfig();
    const sSharedEnvDestination = (process.env.S4_DESTINATION || process.env.S4_API_DESTINATION || '').toString().trim();

    if (sSharedEnvDestination) {
      oRequires.purchaseorder_api.credentials.destination = sSharedEnvDestination;
      oRequires.goodsreceipt_api.credentials.destination = sSharedEnvDestination;
      cds.log('gatepass-s4').info(`Applied shared S4 destination ${sSharedEnvDestination} to purchaseorder_api and goodsreceipt_api.`);
      return;
    }

    if (oOverride.po && !oOverride.gr) {
      oRequires.goodsreceipt_api.credentials.destination = oOverride.po;
      cds.log('gatepass-s4').info(`Mirrored purchaseorder_api destination ${oOverride.po} to goodsreceipt_api.`);
      return;
    }
    if (oOverride.gr && !oOverride.po) {
      oRequires.purchaseorder_api.credentials.destination = oOverride.gr;
      cds.log('gatepass-s4').info(`Mirrored goodsreceipt_api destination ${oOverride.gr} to purchaseorder_api.`);
      return;
    }

    const sPOConfigured = (oRequires.purchaseorder_api.credentials.destination || '').toString().trim();
    const sGRConfigured = (oRequires.goodsreceipt_api.credentials.destination || '').toString().trim();
    if (sPOConfigured && !sGRConfigured) {
      oRequires.goodsreceipt_api.credentials.destination = sPOConfigured;
      cds.log('gatepass-s4').info(`Aligned empty goodsreceipt_api destination to purchaseorder_api destination ${sPOConfigured}.`);
    } else if (!sPOConfigured && sGRConfigured) {
      oRequires.purchaseorder_api.credentials.destination = sGRConfigured;
      cds.log('gatepass-s4').info(`Aligned empty purchaseorder_api destination to goodsreceipt_api destination ${sGRConfigured}.`);
    }
  }

  _normalizeServiceRoot(sRoot, sFallback) {
    const sResolved = (sRoot || sFallback || '').toString().trim();
    if (!sResolved) {
      return '';
    }
    return sResolved.startsWith('/') ? sResolved.replace(/\/+$/, '') : `/${sResolved.replace(/\/+$/, '')}`;
  }

  _getPOServiceRoot() {
    const sConfigured = process.env.S4_PO_SERVICE_ROOT ||
      cds.env?.requires?.purchaseorder_api?.serviceRoot;
    return this._normalizeServiceRoot(sConfigured, '/sap/api_purchaseorder_2/srvd_a2x/sap/purchaseorder/0001');
  }

  _getGRServiceRoot() {
    const sConfigured = process.env.S4_GR_SERVICE_ROOT ||
      cds.env?.requires?.goodsreceipt_api?.serviceRoot;
    return this._normalizeServiceRoot(sConfigured, '/sap/api_sspopenitmgoodsreceipt/srvd_a2x/sap/sspopenitmgoodsreceipt/0001');
  }

  _buildS4Path(sServiceRoot, sRelativePath) {
    const sRoot = this._normalizeServiceRoot(sServiceRoot, '');
    const sPath = (sRelativePath || '').toString();
    if (!sRoot) {
      return sPath.startsWith('/') ? sPath : `/${sPath}`;
    }
    if (!sPath) {
      return sRoot;
    }
    return `${sRoot}${sPath.startsWith('/') ? sPath : `/${sPath}`}`;
  }

  _isRemoteNotFoundError(error) {
    const iStatus = (
      error?.reason?.status ||
      error?.reason?.response?.status ||
      error?.statusCode ||
      error?.status ||
      null
    );
    if (Number(iStatus) === 404) {
      return true;
    }

    const sCode = (
      error?.reason?.response?.body?.error?.code ||
      error?.reason?.code ||
      error?.code ||
      ''
    ).toString();
    return sCode.includes('/IWBEP/CM_V4S_RUN/000');
  }

  _getRemoteErrorStatus(error) {
    const iStatus = (
      error?.reason?.status ||
      error?.reason?.response?.status ||
      error?.response?.status ||
      error?.statusCode ||
      error?.status ||
      null
    );
    return Number(iStatus) || null;
  }

  _getRemoteErrorCode(error) {
    return (
      error?.reason?.response?.body?.error?.code ||
      error?.response?.body?.error?.code ||
      error?.reason?.code ||
      error?.code ||
      ''
    ).toString();
  }

  _getRemoteErrorMessage(error) {
    const vMessage = (
      error?.reason?.response?.body?.error?.message?.value ||
      error?.reason?.response?.body?.error?.message ||
      error?.response?.body?.error?.message?.value ||
      error?.response?.body?.error?.message ||
      error?.reason?.message ||
      error?.message ||
      ''
    );
    if (typeof vMessage === 'string') {
      return vMessage.trim();
    }
    return String(vMessage || '').trim();
  }

  _isRemoteAuthorizationError(error) {
    const iStatus = this._getRemoteErrorStatus(error);
    if (iStatus === 401 || iStatus === 403) {
      return true;
    }

    const sCode = this._getRemoteErrorCode(error);
    if (sCode.includes('/IWBEP/CM_V4_COS/011')) {
      return true;
    }

    const sMessage = this._getRemoteErrorMessage(error).toLowerCase();
    return sMessage.includes('no authorization') || sMessage.includes('not authorized');
  }

  _buildGRAuthorizationErrorMessage(error) {
    const sUpstreamMessage = this._getRemoteErrorMessage(error);
    if (sUpstreamMessage) {
      return `S/4 authorization error for API_SSPOPENITMGOODSRECEIPT: ${sUpstreamMessage}`;
    }
    return 'S/4 authorization error for API_SSPOPENITMGOODSRECEIPT. Please assign required authorizations and retry.';
  }

  _buildPOAuthorizationErrorMessage(error) {
    const sUpstreamMessage = this._getRemoteErrorMessage(error);
    if (sUpstreamMessage) {
      return `S/4 authorization error for API_PURCHASEORDER_2: ${sUpstreamMessage}`;
    }
    return 'S/4 authorization error for API_PURCHASEORDER_2. Please assign required authorizations and retry.';
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
      let poDetails = null;
      try {
        poDetails = await this._fetchPODetails(data.referenceNumber, req);
      } catch (e) {
        if (this._isRemoteAuthorizationError(e)) {
          return req.reject(403, this._buildPOAuthorizationErrorMessage(e));
        }
        throw e;
      }
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
    const sInvoiceValue = (data.invoiceValue !== null && data.invoiceValue !== undefined && String(data.invoiceValue).trim() !== '')
      ? String(data.invoiceValue).trim()
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
      invoiceValue: sInvoiceValue,
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
    try {
      return await this._fetchPODetails(poNumber, req);
    } catch (e) {
      if (this._isRemoteAuthorizationError(e)) {
        return req.reject(403, this._buildPOAuthorizationErrorMessage(e));
      }
      throw e;
    }
  }

  /**
   * Function: Get Purchase Order Snapshot (header + item rows JSON)
   */
  async _onGetPurchaseOrderSnapshot(req) {
    const { poNumber } = req.data;
    try {
      const aRows = await this._fetchPORows(poNumber, req);
      const oFirst = aRows[0] || {};
      return {
        plant: oFirst.plant || '',
        supplierNumber: oFirst.vendor || '',
        supplierName: oFirst.vendor_name || '',
        itemsJson: JSON.stringify(aRows || [])
      };
    } catch (e) {
      if (this._isRemoteAuthorizationError(e)) {
        return req.reject(403, this._buildPOAuthorizationErrorMessage(e));
      }
      throw e;
    }
  }

  /**
   * Function: Get open Goods Receipt items for a Purchase Order
   */
  async _onGetGoodsReceiptOpenItems(req) {
    const { poNumber } = req.data || {};
    try {
      const aRows = await this._fetchGoodsReceiptOpenItems(poNumber, req);
      return {
        itemsJson: JSON.stringify(aRows)
      };
    } catch (e) {
      if (this._isRemoteAuthorizationError(e)) {
        return req.reject(403, this._buildGRAuthorizationErrorMessage(e));
      }
      throw e;
    }
  }

  /**
   * Action: Post Goods Receipt for selected Gate Pass items
   */
  async _onPostGoodsReceipt(req) {
    const oLog = cds.log('gatepass-gr');
    const { gateEntryID, itemsJson } = req.data || {};
    if (!gateEntryID) {
      return req.error(400, 'Gate Entry is mandatory');
    }

    let aSelectedItems = [];
    try {
      aSelectedItems = typeof itemsJson === 'string' ? JSON.parse(itemsJson || '[]') : (itemsJson || []);
      if (!Array.isArray(aSelectedItems)) {
        aSelectedItems = [];
      }
    } catch (e) {
      return req.error(400, 'Selected Goods Receipt items payload is invalid');
    }
    if (!aSelectedItems.length) {
      return req.error(400, 'Select at least one item for Goods Receipt');
    }

    const oEntry = await SELECT.one.from(this.entities.GateEntries, gateEntryID).columns('*');
    if (!oEntry) {
      return req.error(404, 'Gate Entry not found');
    }
    if (oEntry.referenceType !== 'PO') {
      return req.error(400, 'Goods Receipt is supported only for Purchase Order references');
    }
    const sPONumber = (oEntry.referenceNumber || '').toString().trim();
    if (!sPONumber) {
      return req.error(400, 'Reference Purchase Order number is missing');
    }

    let aOpenRows = [];
    try {
      aOpenRows = await this._fetchGoodsReceiptOpenItems(sPONumber, req);
    } catch (e) {
      if (this._isRemoteAuthorizationError(e)) {
        return req.reject(403, this._buildGRAuthorizationErrorMessage(e));
      }
      throw e;
    }
    const mOpenByItem = {};
    aOpenRows.forEach((oRow) => {
      const sKey = this._normalizePOItemNumber(oRow.purchaseOrderItem);
      if (sKey) {
        mOpenByItem[sKey] = oRow;
      }
    });

    const sToday = new Date().toISOString().slice(0, 10);
    const aDocs = [];
    for (const oItem of aSelectedItems) {
      const sItemNo = this._normalizePOItemNumber(oItem?.orderItemNumber);
      const nQty = Number(oItem?.challanQuantity);
      if (!sItemNo) {
        return req.error(400, 'Order Item Number is mandatory for Goods Receipt posting');
      }
      if (!Number.isFinite(nQty) || nQty <= 0) {
        return req.error(400, `Challan Quantity must be greater than zero for order item ${sItemNo}`);
      }

      const oOpenItem = mOpenByItem[sItemNo];
      if (!oOpenItem) {
        return req.error(400, `Order item ${sItemNo} is not open for Goods Receipt posting`);
      }

      const oPayload = {
        PURCHASEREQUISITION: (oOpenItem.purchaseRequisition || '').toString(),
        PURCHASEORDER: (oOpenItem.purchaseOrder || sPONumber).toString(),
        PURCHASEORDERITEM: (oOpenItem.purchaseOrderItem || sItemNo).toString(),
        PURCHASEREQUISITIONITEM: (oOpenItem.purchaseRequisitionItem || '').toString(),
        DELIVEREDQUANTITY: nQty,
        DELIVERYSTATUS: true,
        DELIVERYNOTE: '',
        MATERIALDOCUMENTHEADERTEXT: '',
        DOCUMENTDATE: sToday,
        POSTINGDATE: sToday,
        ORDERQUANTITYUNIT: (oOpenItem.purchaseOrderQuantityUnit || '').toString(),
        ORDERQUANTITYUNITISOCODE: (oOpenItem.orderQuantityUnitISOCode || '').toString(),
        PURREQNSSPAUTHOR: '',
        PURREQNSSPREQUESTOR: ''
      };

      oLog.info(`Posting Goods Receipt for PO ${sPONumber} item ${sItemNo}`);
      try {
        const oResult = await this._callPostGoodsReceipt(oPayload, req);
        const sMatDoc = (
          oResult?.MATERIALDOCUMENT ||
          oResult?.MaterialDocument ||
          ''
        ).toString();
        const sMatYear = (
          oResult?.MATERIALDOCUMENTYEAR ||
          oResult?.MaterialDocumentYear ||
          ''
        ).toString();
        aDocs.push({ materialDocument: sMatDoc, materialDocumentYear: sMatYear });
        oLog.info(`Goods Receipt posted for PO ${sPONumber} item ${sItemNo}: ${sMatDoc}/${sMatYear}`);
      } catch (e) {
        oLog.error(`Goods Receipt posting failed for PO ${sPONumber} item ${sItemNo}: ${e.message}`);
        if (e?.reason?.response?.body || e?.response?.body) {
          oLog.error(JSON.stringify(e.reason?.response?.body || e.response?.body));
        }
        if (this._isRemoteAuthorizationError(e)) {
          return req.reject(403, this._buildGRAuthorizationErrorMessage(e));
        }
        throw e;
      }
    }

    const oFirstDoc = aDocs[0] || {};
    return {
      success: true,
      materialDocument: oFirstDoc.materialDocument || '',
      materialDocumentYear: oFirstDoc.materialDocumentYear || '',
      postedItems: aDocs.length,
      message: `Goods Receipt posted for ${aDocs.length} item(s)`
    };
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

  // Helper: Fetch PO details using source strategy (auto/live/mock).
  // Default mode is `auto` to preserve runtime safety: try live, then fallback to mock.
  async _fetchPODetails(poNumber, req) {
    const aRows = await this._fetchPORows(poNumber, req);
    if (!aRows.length) {
      return null;
    }
    const oFirst = aRows[0];
    return {
      plant: oFirst.plant || '',
      supplierNumber: oFirst.vendor || '',
      supplierName: oFirst.vendor_name || ''
    };
  }

  async _fetchPORows(poNumber, req) {
    const sPONumber = (poNumber || '').toString().trim();
    if (!sPONumber) {
      return [];
    }

    const sMode = this._getPOSourceMode();
    if (sMode === 'mock') {
      return this._getMockPORows(sPONumber);
    }
    if (sMode === 'live') {
      try {
        return await this._fetchLivePORows(sPONumber, req);
      } catch (e) {
        if (this._isRemoteNotFoundError(e)) {
          cds.log('gatepass-po').info(`Live PO lookup returned not-found for ${sPONumber}.`);
          return [];
        }
        throw e;
      }
    }

    try {
      return await this._fetchLivePORows(sPONumber, req);
    } catch (e) {
      cds.log('gatepass-po').warn(`Live PO lookup failed for ${sPONumber}. Falling back to mock. ${e.message}`);
      return this._getMockPORows(sPONumber);
    }
  }

  _getPOSourceMode() {
    const sConfigured = (
      process.env.PO_SOURCE ||
      cds.env?.requires?.purchaseorder_api?.source ||
      cds.env?.gatepass?.poSource ||
      'auto'
    ).toString().trim().toLowerCase();

    if (sConfigured === 'live' || sConfigured === 'mock' || sConfigured === 'auto') {
      return sConfigured;
    }
    return 'auto';
  }


  _getMockPORows(poNumber) {
    const sPONumber = (poNumber || '').toString().trim();
    if (!sPONumber) {
      return [];
    }
    return aPOMockData.filter((oRow) => (oRow?.po_no || '').toString() === sPONumber);
  }

  async _fetchLivePORows(poNumber, req) {
    const sPONumber = (poNumber || '').toString().trim();
    if (!sPONumber) {
      return [];
    }
    const sPOServiceRoot = this._getPOServiceRoot();

    const sEscapedPONumber = this._escapeODataString(sPONumber);
    const sHeaderPath = this._buildS4Path(sPOServiceRoot, `/PurchaseOrder('${sEscapedPONumber}')?$select=PurchaseOrder,Supplier`);
    const sItemsPath = this._buildS4Path(sPOServiceRoot, `/PurchaseOrderItem?$filter=PurchaseOrder eq '${sEscapedPONumber}'&$select=PurchaseOrder,PurchaseOrderItem,Material,PurchaseOrderItemText,OrderQuantity,Plant`);
    const sSupplierAddressPath = this._buildS4Path(sPOServiceRoot, `/PurchaseOrder('${sEscapedPONumber}')/_SupplierAddress?$select=AddresseeFullName,OrganizationName1,OrganizationName2`);
    const oPOService = await this._getPOService();
    const oRemoteClient = req ? oPOService.tx(req) : oPOService;
    const oHeaderResponse = await oRemoteClient.send({
      method: 'GET',
      path: sHeaderPath
    });

    let aItemRows = [];
    try {
      const oItemsResponse = await oRemoteClient.send({
        method: 'GET',
        path: sItemsPath
      });
      aItemRows = this._normalizeCollection(oItemsResponse);
    } catch (e) {
      cds.log('gatepass-po').warn(`Live PO item lookup failed for ${sPONumber}. Returning header-only data. ${e.message}`);
    }

    let oSupplierAddress = null;
    try {
      const oSupplierAddressResponse = await oRemoteClient.send({
        method: 'GET',
        path: sSupplierAddressPath
      });
      const aAddressRows = this._normalizeCollection(oSupplierAddressResponse);
      oSupplierAddress = aAddressRows[0] || (oSupplierAddressResponse && typeof oSupplierAddressResponse === 'object' ? oSupplierAddressResponse : null);
    } catch (e) {
      cds.log('gatepass-po').warn(`Live PO supplier address lookup failed for ${sPONumber}. ${e.message}`);
    }

    const oResponse = {
      ...(oHeaderResponse || {}),
      to_PurchaseOrderItem: aItemRows,
      _SupplierAddress: oSupplierAddress
    };
    this._throwIfBlockingSAPMessages(oHeaderResponse, sPONumber);
    this._throwIfBlockingSAPMessages(oResponse, sPONumber);
    return this._mapLivePOPayloadToContractRows(oResponse, sPONumber);
  }

  async _getPOService() {
    if (this._poService) {
      return this._poService;
    }
    this._poService = await cds.connect.to('purchaseorder_api');
    return this._poService;
  }

  async _getGRService() {
    if (this._grService) {
      return this._grService;
    }
    this._grService = await cds.connect.to('goodsreceipt_api');
    return this._grService;
  }

  async _fetchGoodsReceiptOpenItems(poNumber, req) {
    const sPONumber = (poNumber || '').toString().trim();
    if (!sPONumber) {
      return [];
    }
    const sGRServiceRoot = this._getGRServiceRoot();
    const sEscapedPONumber = this._escapeODataString(sPONumber);
    const sPath = this._buildS4Path(sGRServiceRoot, `/A_SSPOpenItemGoodsReceipt?$filter=PurchaseOrder eq '${sEscapedPONumber}' and DeliveryStatus eq false&$select=PurchaseRequisition,PurchaseOrder,PurchaseOrderItem,PurchaseRequisitionItem,DeliveredQuantity,DeliveryStatus,PurchaseOrderQuantityUnit,OrderQuantityUnitISOCode`);
    const oGRService = await this._getGRService();
    const oRemoteClient = req ? oGRService.tx(req) : oGRService;
    try {
      const oResponse = await oRemoteClient.send({
        method: 'GET',
        path: sPath
      });
      this._throwIfBlockingSAPMessages(oResponse, sPONumber);
      const aRows = this._normalizeCollection(oResponse).map((oRow) => this._mapGROpenItem(oRow));
      return aRows.filter((oRow) => !oRow.deliveryStatus);
    } catch (e) {
      cds.log('gatepass-gr').error(`Failed to fetch Goods Receipt open items for PO ${sPONumber}: ${e.message}`);
      if (e?.reason?.response?.body || e?.response?.body) {
        cds.log('gatepass-gr').error(JSON.stringify(e.reason?.response?.body || e.response?.body));
      }
      throw e;
    }
  }

  _mapGROpenItem(oRow) {
    return {
      purchaseRequisition: this._pickFirstValue(oRow, ['PurchaseRequisition', 'purchaseRequisition']) || '',
      purchaseOrder: this._pickFirstValue(oRow, ['PurchaseOrder', 'purchaseOrder']) || '',
      purchaseOrderItem: this._pickFirstValue(oRow, ['PurchaseOrderItem', 'purchaseOrderItem']) || '',
      purchaseRequisitionItem: this._pickFirstValue(oRow, ['PurchaseRequisitionItem', 'purchaseRequisitionItem']) || '',
      deliveredQuantity: Number(this._pickFirstValue(oRow, ['DeliveredQuantity', 'deliveredQuantity']) || 0),
      deliveryStatus: this._toBoolean(this._pickFirstValue(oRow, ['DeliveryStatus', 'deliveryStatus'])),
      purchaseOrderQuantityUnit: this._pickFirstValue(oRow, ['PurchaseOrderQuantityUnit', 'purchaseOrderQuantityUnit']) || '',
      orderQuantityUnitISOCode: this._pickFirstValue(oRow, ['OrderQuantityUnitISOCode', 'orderQuantityUnitISOCode']) || ''
    };
  }

  _toBoolean(vValue) {
    if (typeof vValue === 'boolean') {
      return vValue;
    }
    if (typeof vValue === 'number') {
      return vValue !== 0;
    }
    if (vValue === null || vValue === undefined) {
      return false;
    }
    const sValue = String(vValue).trim().toLowerCase();
    if (!sValue) {
      return false;
    }
    if (sValue === 'false' || sValue === '0' || sValue === 'no' || sValue === 'n') {
      return false;
    }
    return sValue === 'true' || sValue === '1' || sValue === 'yes' || sValue === 'y' || sValue === 'x';
  }

  _normalizePOItemNumber(vValue) {
    const sRaw = (vValue || '').toString().trim();
    if (!sRaw) {
      return '';
    }
    const sDigits = sRaw.replace(/[^0-9]/g, '');
    if (!sDigits) {
      return sRaw.toUpperCase();
    }
    return sDigits.padStart(5, '0').slice(-5);
  }

  async _callPostGoodsReceipt(payload, req) {
    const oGRService = await this._getGRService();
    const oRemoteClient = req ? oGRService.tx(req) : oGRService;
    const sGRServiceRoot = this._getGRServiceRoot();
    return oRemoteClient.send({
      method: 'POST',
      path: this._buildS4Path(sGRServiceRoot, '/A_SSPOpenItemGoodsReceipt/PostGoodsReceipt'),
      data: payload
    });
  }

  _escapeODataString(value) {
    return String(value || '').replace(/'/g, "''");
  }

  _throwIfBlockingSAPMessages(payload, poNumber) {
    if (payload?.error) {
      const sMessage = payload.error.message?.value || payload.error.message || 'S/4 service returned an error response';
      throw new Error(`[PO ${poNumber}] ${sMessage}`);
    }

    const aMessages = this._normalizeCollection(payload?.SAP__Messages);
    if (!aMessages.length) {
      return;
    }

    const aBlocking = aMessages.filter((oMsg) => {
      const sSeverity = (oMsg?.severity || oMsg?.type || oMsg?.numericSeverity || '').toString().toUpperCase();
      return sSeverity === 'E' || sSeverity === 'A' || sSeverity === 'ERROR';
    });

    if (aBlocking.length) {
      const sFirst = aBlocking[0]?.message || aBlocking[0]?.longtext_url || 'Blocking SAP message in response';
      throw new Error(`[PO ${poNumber}] ${sFirst}`);
    }
  }

  _mapLivePOPayloadToContractRows(payload, poNumber) {
    const oRoot = Array.isArray(payload?.value) ? payload.value[0] : payload;
    if (!oRoot || typeof oRoot !== 'object') {
      return [];
    }

    const sHeaderPO = this._pickFirstValue(oRoot, ['PurchaseOrder', 'purchaseOrder']) || poNumber;
    const sVendor = this._pickFirstValue(oRoot, ['Supplier', 'supplier', 'Vendor', 'vendor']) || '';
    const oSupplierAddress = oRoot._SupplierAddress || oRoot.to_SupplierAddress || null;
    const sVendorName = this._pickFirstValue(oRoot, ['SupplierName', 'supplierName', 'VendorName', 'vendorName']) ||
      this._pickFirstValue(oSupplierAddress, ['AddresseeFullName', 'addresseeFullName', 'OrganizationName1', 'organizationName1', 'OrganizationName2', 'organizationName2']) ||
      '';
    const sHeaderPlant = this._pickFirstValue(oRoot, ['Plant', 'plant']) || '';

    const aItems = this._normalizeCollection(
      oRoot.to_PurchaseOrderItem ||
      oRoot.to_PurchaseOrderItemTP ||
      oRoot.PurchaseOrderItem
    );

    if (!aItems.length) {
      return [{
        po_no: sHeaderPO,
        item_no: '10',
        material_no: '',
        material_description: '',
        po_qty: null,
        vendor: sVendor,
        vendor_name: sVendorName,
        plant: sHeaderPlant
      }];
    }

    return aItems.map((oItem, iIndex) => ({
      po_no: this._pickFirstValue(oItem, ['PurchaseOrder', 'purchaseOrder']) || sHeaderPO,
      item_no: this._pickFirstValue(oItem, ['PurchaseOrderItem', 'purchaseOrderItem']) || String((iIndex + 1) * 10),
      material_no: this._pickFirstValue(oItem, ['Material', 'material']) || '',
      material_description: this._pickFirstValue(oItem, ['PurchaseOrderItemText', 'purchaseOrderItemText', 'MaterialName', 'materialDescription']) || '',
      po_qty: this._pickFirstValue(oItem, ['OrderQuantity', 'orderQuantity', 'RequestedQuantity', 'requestedQuantity']),
      vendor: sVendor,
      vendor_name: sVendorName,
      plant: this._pickFirstValue(oItem, ['Plant', 'plant']) || sHeaderPlant
    }));
  }

  _normalizeCollection(value) {
    if (!value) {
      return [];
    }
    if (Array.isArray(value)) {
      return value;
    }
    if (Array.isArray(value.value)) {
      return value.value;
    }
    if (Array.isArray(value.results)) {
      return value.results;
    }
    return [];
  }

  _pickFirstValue(source, keys) {
    if (!source || !Array.isArray(keys)) {
      return null;
    }
    for (const sKey of keys) {
      const v = source[sKey];
      if (v !== undefined && v !== null && String(v).trim() !== '') {
        return v;
      }
    }
    return null;
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
