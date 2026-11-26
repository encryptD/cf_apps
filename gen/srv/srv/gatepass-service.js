const cds = require('@sap/cds');
const { executeHttpRequest } = require('@sap-cloud-sdk/http-client');
const { randomUUID } = require('node:crypto');
const aPOMockData = require('./mock/po-mock-data.json');
const CBO_SERVICE_ROOTS = Object.freeze({
  GateEntries: '/sap/opu/odata/sap/YY1_ZGT_GATE_ENTRY_CDS',
  GatePasses: '/sap/opu/odata/sap/YY1_GATEPASS_DETAILS_CDS',
  GatePassItems: '/sap/opu/odata/sap/YY1_GATEPASSITEMS_CDS',
  GateExit: '/sap/opu/odata/sap/YY1_GATEEXIT_CDS',
  InvoiceHeaders: '/sap/opu/odata/sap/YY1_GATEPASS_INVOICEHEADER_CDS',
  Plants: '/sap/opu/odata/sap/YY1_GATEPASS_PLANTS_CDS'
});
const CBO_ENTITY_SETS = Object.freeze({
  GateEntries: 'YY1_ZGT_GATE_ENTRY',
  GatePasses: 'YY1_GATEPASS_DETAILS',
  GatePassItems: 'YY1_GATEPASSITEMS',
  GateExit: 'YY1_GATEEXIT',
  InvoiceHeaders: 'YY1_GATEPASS_INVOICEHEADER',
  Plants: 'YY1_GATEPASS_PLANTS'
});
// materialItemsJson lives in a CBO string field with MaxLength=500 — persist with
// short keys and expand back to full field names on read (backward compatible).
const MATERIAL_ITEMS_KEY_MAP = Object.freeze({
  itemNumber: 'in',
  deliveryNumber: 'dn',
  materialCode: 'mc',
  materialDescription: 'md',
  quantity: 'q',
  challanQuantity: 'cq',
  goodsRecipient: 'gr',
  unitOfMeasure: 'uom',
  orderItemNumber: 'oi',
  plant: 'pl',
  storageLocation: 'sl',
  batch: 'b',
  dateOfManufacture: 'dom'
});
const MATERIAL_ITEMS_KEY_MAP_REVERSE = Object.freeze(
  Object.fromEntries(Object.entries(MATERIAL_ITEMS_KEY_MAP).map(([sKey, sShort]) => [sShort, sKey]))
);

class GatePassService extends cds.ApplicationService {
  async init() {
    this._harmonizeS4Destinations();
    this.on('READ', 'GateEntries', this._onReadGateEntries);
    this.on('CREATE', 'GateEntries', this._onCreateGateEntry);
    this.on('UPDATE', 'GateEntries', this._onUpdateGateEntry);
    this.on('READ', 'GatePasses', this._onReadGatePasses);
    this.on('READ', 'GatePassItems', this._onReadGatePassItems);
    this.on('READ', 'GateExit', this._onReadGateExit);
    this.on('READ', 'Plants', this._onReadPlants);
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
    this.on('getPurchaseOrderReceivedSnapshot', this._onGetPurchaseOrderReceivedSnapshot);
    this.on('getGoodsReceiptOpenItems', this._onGetGoodsReceiptOpenItems);
    this.on('getSalesInvoiceDetails', this._onGetSalesInvoiceDetails);
    this.on('getGatePassReport', this._onGetGatePassReport);
    return super.init();
  }

  async _fetchS4MaterialDocumentItemsByPO(poNumber, req) {
    const sPONumber = (poNumber || '').toString().trim();
    if (!sPONumber) {
      return [];
    }
    const sFilter = `PurchaseOrder eq '${this._escapeODataString(sPONumber)}'`;
    const sPath = this._buildS4Path(
      this._getGRServiceRoot(),
      `/A_MaterialDocumentItem?$filter=${sFilter}&$select=PurchaseOrder,PurchaseOrderItem,MaterialDocumentYear,GoodsMovementType,DebitCreditCode,EntryUnit,QuantityInEntryUnit&$top=5000&$format=json`
    );
    const oGRService = await this._getGRService();
    const oRemoteClient = req ? oGRService.tx(req) : oGRService;
    const oResponse = await oRemoteClient.send({
      method: 'GET',
      path: sPath
    });
    return this._extractODataV2Results(oResponse);
  }

  _resolveMaterialDocumentYear(oRow) {
    const nYearFromField = Number.parseInt(
      this._pickFirstValue(oRow, ['MaterialDocumentYear', 'materialDocumentYear']) || '',
      10
    );
    if (Number.isInteger(nYearFromField)) {
      return nYearFromField;
    }
    const sPostingDate = this._fromODataV2Date(
      this._pickFirstValue(oRow, ['PostingDate', 'postingDate']) || null
    );
    if (!this._isNormalizedDate(sPostingDate)) {
      return null;
    }
    const nYearFromDate = Number.parseInt(sPostingDate.slice(0, 4), 10);
    return Number.isInteger(nYearFromDate) ? nYearFromDate : null;
  }

  _resolveSignedMaterialDocumentQuantity(oRow) {
    const nQty = this._toNumber(
      this._pickFirstValue(oRow, ['QuantityInEntryUnit', 'quantityInEntryUnit'])
    );
    if (nQty === null || nQty === 0) {
      return 0;
    }
    const sMovementType = (
      this._pickFirstValue(oRow, ['GoodsMovementType', 'goodsMovementType']) || ''
    ).toString().trim();
    if (sMovementType && sMovementType !== '101' && sMovementType !== '102') {
      return 0;
    }
    const sDebitCreditCode = (
      this._pickFirstValue(oRow, ['DebitCreditCode', 'debitCreditCode']) || ''
    ).toString().trim().toUpperCase();
    const bNegative = sMovementType === '102' || sDebitCreditCode === 'H';
    const nAbsoluteQty = Math.abs(nQty);
    return bNegative ? -nAbsoluteQty : nAbsoluteQty;
  }

  _getCBODestinationName() {
    return (
      process.env.S4_CBO_DESTINATION ||
      process.env.S4_DESTINATION ||
      process.env.S4_API_DESTINATION ||
      cds.env?.requires?.purchaseorder_api?.credentials?.destination ||
      'MY410644'
    ).toString().trim();
  }

  _escapeUrlParam(value) {
    return encodeURIComponent((value || '').toString());
  }

  _escapeODataV2String(value) {
    return (value || '').toString().replace(/'/g, "''");
  }

  _getRequestFilter(req) {
    return (req && req._queryOptions && req._queryOptions.$filter) ? req._queryOptions.$filter : '';
  }

  _getRequestTop(req, fallback = 1000) {
    const sTop = req && req._queryOptions ? req._queryOptions.$top : '';
    const nTop = Number.parseInt(sTop, 10);
    return Number.isFinite(nTop) && nTop > 0 ? nTop : fallback;
  }

  _buildODataQuery(params = {}) {
    const aPairs = [];
    Object.entries(params).forEach(([sKey, vValue]) => {
      if (vValue === undefined || vValue === null || vValue === '') {
        return;
      }
      aPairs.push(`${sKey}=${this._escapeUrlParam(vValue)}`);
    });
    return aPairs.length ? `?${aPairs.join('&')}` : '';
  }

  _extractODataV2Results(payload) {
    const oData = payload && payload.data ? payload.data : payload;
    // CAP remote service .send() can return a bare results array
    if (Array.isArray(oData)) {
      return oData;
    }
    if (!oData || typeof oData !== 'object') {
      return [];
    }
    if (Array.isArray(oData?.d?.results)) {
      return oData.d.results;
    }
    if (oData?.d && typeof oData.d === 'object') {
      return [oData.d];
    }
    if (Array.isArray(oData?.value)) {
      return oData.value;
    }
    return [];
  }

  _firstResult(payload) {
    const aRows = this._extractODataV2Results(payload);
    return aRows[0] || null;
  }

  _toMovementTypeFromCBO(value) {
    const sValue = (value || '').toString().trim().toUpperCase();
    if (sValue === 'IN') {
      return 'I';
    }
    if (sValue === 'OUT') {
      return 'O';
    }
    return sValue || null;
  }

  _toMovementTypeForCBO(value) {
    const sValue = (value || '').toString().trim().toUpperCase();
    if (sValue === 'I') {
      return 'IN';
    }
    if (sValue === 'O') {
      return 'OUT';
    }
    return sValue || null;
  }

  _fromODataV2Date(value) {
    if (!value) {
      return null;
    }
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return this._normalizeDate(value);
    }
    const sValue = value.toString();
    const oMatch = sValue.match(/\/Date\((\d+)\)\//);
    if (oMatch) {
      const nMillis = Number.parseInt(oMatch[1], 10);
      if (Number.isFinite(nMillis)) {
        return this._normalizeDate(new Date(nMillis));
      }
    }
    const sNormalized = this._normalizeDate(sValue);
    return this._isNormalizedDate(sNormalized) ? sNormalized : null;
  }

  _toODataV2Date(value) {
    if (!value) {
      return null;
    }
    const sDate = this._normalizeDate(value);
    if (!this._isNormalizedDate(sDate)) {
      return null;
    }
    return this._toODataV2DateTime(`${sDate}T00:00:00`);
  }

  _fromODataV2Duration(value) {
    if (!value) {
      return null;
    }
    const sValue = value.toString().trim();
    if (this._isNormalizedTime(sValue)) {
      return sValue;
    }
    const oMatch = sValue.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i);
    if (!oMatch) {
      return null;
    }
    const nHours = Number.parseInt(oMatch[1] || '0', 10);
    const nMinutes = Number.parseInt(oMatch[2] || '0', 10);
    const nSeconds = Number.parseInt(oMatch[3] || '0', 10);
    return `${String(nHours).padStart(2, '0')}:${String(nMinutes).padStart(2, '0')}:${String(nSeconds).padStart(2, '0')}`;
  }

  _toODataV2Duration(value) {
    if (!value) {
      return null;
    }
    const sTime = this._normalizeTime(value);
    if (!this._isNormalizedTime(sTime)) {
      return null;
    }
    const [sHours, sMinutes, sSeconds] = sTime.split(':');
    return `PT${Number.parseInt(sHours, 10)}H${Number.parseInt(sMinutes, 10)}M${Number.parseInt(sSeconds, 10)}S`;
  }

  _mapGateEntryFromCBO(oRow) {
    if (!oRow) {
      return null;
    }
    const oMapped = {
      ID: oRow.ID || oRow.id || null,
      gateEntryNumber: oRow.GateEntryNumber || oRow.gateEntryNumber || '',
      gateEntryYear: Number.parseInt(oRow.gateEntryYear || oRow.GateEntryYear || '', 10) || null,
      movementType: this._toMovementTypeFromCBO(oRow.movementType || oRow.MovementType),
      documentStatus: oRow.documentStatus || oRow.DocumentStatus || null,
      entryStatus: oRow.entryStatus || oRow.EntryStatus || null,
      plant: oRow.plant || oRow.Plant || null,
      partyNumber: oRow.partyNumber || oRow.PartyNumber || null,
      partyName: oRow.partyName || oRow.PartyName || null,
      referenceType: oRow.referenceType || oRow.ReferenceType || null,
      referenceNumber: oRow.referenceNumber || oRow.ReferenceNumber || null,
      vehicleNumber: oRow.vehicleNumber || oRow.VehicleNumber || null,
      vehicleType: oRow.vehicleType || oRow.VehicleType || null,
      transporterNumber: oRow.transporterNumber || oRow.TransporterNumber || null,
      transporterName: oRow.transporterName || oRow.TransporterName || null,
      driverName: oRow.driverName || oRow.DriverName || null,
      driverContact: oRow.driverContact || oRow.DriverContact || null,
      lrNumber: oRow.lrNumber || oRow.LrNumber || null,
      entryDate: this._fromODataV2Date(oRow.entryDate || oRow.EntryDate),
      entryTime: this._fromODataV2Duration(oRow.entryTime || oRow.EntryTime),
      remarks: oRow.remarks || oRow.Remarks || null,
      invoiceDate: this._fromODataV2Date(oRow.invoiceDate || oRow.InvoiceDate),
      invoiceValue: oRow.invoiceNo || oRow.InvoiceNo || null,
      eWayBillNumber: oRow.eWayBillNumber || oRow.EWayBillNumber || null,
      eWayBillDate: this._fromODataV2Date(oRow.eWayBillDate || oRow.EWayBillDate),
      shippingAddress: oRow.shippingAddress || oRow.ShippingAddress || null,
      passDate: this._fromODataV2Date(oRow.passDate || oRow.PassDate),
      passTime: this._fromODataV2Duration(oRow.passTime || oRow.PassTime),
      passRemarks: oRow.passRemarks || oRow.PassRemarks || null,
      materialItemsJson: this._expandMaterialItemsJsonString(oRow.materialItemsJson || oRow.MaterialItemsJson || null)
    };
    return oMapped;
  }

  _mapGateEntryToCBO(oData = {}, bForPatch = false) {
    const fnHas = (sKey) => Object.prototype.hasOwnProperty.call(oData, sKey);
    const vGateEntryYear = oData.gateEntryYear !== undefined && oData.gateEntryYear !== null && oData.gateEntryYear !== ''
      ? String(oData.gateEntryYear)
      : undefined;
    const oPayload = {
      ID: oData.ID || undefined,
      GateEntryNumber: oData.gateEntryNumber || undefined,
      gateEntryYear: vGateEntryYear,
      movementType: fnHas('movementType') ? this._toMovementTypeForCBO(oData.movementType) : undefined,
      documentStatus: oData.documentStatus || undefined,
      entryStatus: oData.entryStatus || undefined,
      plant: oData.plant || undefined,
      partyNumber: oData.partyNumber || undefined,
      partyName: oData.partyName || undefined,
      referenceType: oData.referenceType || undefined,
      referenceNumber: oData.referenceNumber || undefined,
      vehicleNumber: oData.vehicleNumber || undefined,
      vehicleType: oData.vehicleType || undefined,
      transporterNumber: oData.transporterNumber || undefined,
      transporterName: oData.transporterName || undefined,
      driverName: oData.driverName || undefined,
      driverContact: oData.driverContact || undefined,
      lrNumber: oData.lrNumber || undefined,
      entryDate: fnHas('entryDate') ? this._toODataV2Date(oData.entryDate) : undefined,
      entryTime: fnHas('entryTime') ? this._toODataV2Duration(oData.entryTime) : undefined,
      remarks: oData.remarks || undefined,
      invoiceDate: fnHas('invoiceDate') ? this._toODataV2Date(oData.invoiceDate) : undefined,
      invoiceNo: oData.invoiceValue || undefined,
      eWayBillNumber: oData.eWayBillNumber || undefined,
      eWayBillDate: fnHas('eWayBillDate') ? this._toODataV2Date(oData.eWayBillDate) : undefined,
      shippingAddress: oData.shippingAddress || undefined,
      passDate: fnHas('passDate') ? this._toODataV2Date(oData.passDate) : undefined,
      passTime: fnHas('passTime') ? this._toODataV2Duration(oData.passTime) : undefined,
      passRemarks: oData.passRemarks || undefined,
      materialItemsJson: this._compactMaterialItemsJsonForCBO(oData.materialItemsJson, oData.movementType)
    };
    Object.keys(oPayload).forEach((sKey) => {
      if (oPayload[sKey] === undefined || (bForPatch && sKey === 'ID')) {
        delete oPayload[sKey];
      }
    });
    return oPayload;
  }

  async _executeCBORequest({ entityName, method = 'GET', path = '', query = null, data = null }) {
    const sDestination = this._getCBODestinationName();
    if (!sDestination) {
      throw new Error('S/4 CBO destination is not configured.');
    }
    const sRoot = CBO_SERVICE_ROOTS[entityName];
    if (!sRoot) {
      throw new Error(`Unsupported CBO entity service root: ${entityName}`);
    }
    const sResolvedPath = path || `/${CBO_ENTITY_SETS[entityName]}`;
    const sQuery = query || '';
    const sUrl = `${sRoot}${sResolvedPath}${sQuery}`;
    const oOptions = {
      method,
      url: sUrl,
      headers: {
        Accept: 'application/json'
      }
    };
    if (data) {
      oOptions.data = data;
      oOptions.headers['Content-Type'] = 'application/json';
    }
    const bNeedsCsrf = method !== 'GET';
    return executeHttpRequest(
      { destinationName: sDestination },
      oOptions,
      { fetchCsrfToken: bNeedsCsrf }
    );
  }

  async _listCBOEntities(entityName, req, fallbackTop = 1000) {
    const sFilter = this._getRequestFilter(req);
    const nTop = this._getRequestTop(req, fallbackTop);
    const sQuery = this._buildODataQuery({
      $format: 'json',
      $filter: sFilter || undefined,
      $top: nTop
    });
    const oResponse = await this._executeCBORequest({
      entityName,
      method: 'GET',
      path: `/${CBO_ENTITY_SETS[entityName]}`,
      query: sQuery
    });
    return this._extractODataV2Results(oResponse);
  }

  async _getCBOEntityByID(entityName, id) {
    const sID = (id || '').toString().trim();
    if (!sID) {
      return null;
    }
    const sFilter = `ID eq '${this._escapeODataV2String(sID)}'`;
    const sQuery = this._buildODataQuery({
      $format: 'json',
      $filter: sFilter,
      $top: 1
    });
    const oResponse = await this._executeCBORequest({
      entityName,
      method: 'GET',
      path: `/${CBO_ENTITY_SETS[entityName]}`,
      query: sQuery
    });
    return this._firstResult(oResponse);
  }
  _isGUID(value) {
    const sValue = (value || '').toString().trim();
    return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(sValue);
  }

  _extractSAPUUID(oRow) {
    if (!oRow || typeof oRow !== 'object') {
      return null;
    }
    const sDirect = (oRow.SAP_UUID || oRow.sap_uuid || '').toString().trim();
    if (this._isGUID(sDirect)) {
      return sDirect;
    }
    const sMetaURI = (
      oRow?.__metadata?.uri ||
      oRow?.__metadata?.id ||
      ''
    ).toString();
    const oMatch = sMetaURI.match(/guid'([0-9a-fA-F-]{36})'/);
    if (oMatch && this._isGUID(oMatch[1])) {
      return oMatch[1];
    }
    return null;
  }

  _buildCBOSAPUUIDPath(entityName, sSAPUUID) {
    if (!this._isGUID(sSAPUUID)) {
      throw new Error(`Invalid SAP_UUID for ${entityName}: ${sSAPUUID}`);
    }
    return `/${CBO_ENTITY_SETS[entityName]}(guid'${sSAPUUID}')`;
  }

  async _getCBOEntityBySAPUUID(entityName, sSAPUUID) {
    if (!this._isGUID(sSAPUUID)) {
      return null;
    }
    const oResponse = await this._executeCBORequest({
      entityName,
      method: 'GET',
      path: this._buildCBOSAPUUIDPath(entityName, sSAPUUID),
      query: this._buildODataQuery({ $format: 'json' })
    });
    return this._firstResult(oResponse);
  }

  async _resolveCBOSAPUUIDByBusinessID(entityName, id) {
    const sID = (id || '').toString().trim();
    if (!sID) {
      return null;
    }
    const oByID = await this._getCBOEntityByID(entityName, sID);
    const sUUIDFromID = this._extractSAPUUID(oByID);
    if (sUUIDFromID) {
      return sUUIDFromID;
    }
    if (!this._isGUID(sID)) {
      return null;
    }
    const oByUUID = await this._getCBOEntityBySAPUUID(entityName, sID);
    const sUUIDFromUUID = this._extractSAPUUID(oByUUID);
    return sUUIDFromUUID || null;
  }

  async _createCBOEntity(entityName, payload) {
    const oResponse = await this._executeCBORequest({
      entityName,
      method: 'POST',
      path: `/${CBO_ENTITY_SETS[entityName]}`,
      data: payload
    });
    return this._firstResult(oResponse);
  }

  async _updateCBOEntity(entityName, id, payload) {
    const sSAPUUID = await this._resolveCBOSAPUUIDByBusinessID(entityName, id);
    if (!sSAPUUID) {
      throw new Error(`Failed to resolve SAP_UUID for ${entityName} ID ${id}`);
    }
    await this._executeCBORequest({
      entityName,
      method: 'PATCH',
      path: this._buildCBOSAPUUIDPath(entityName, sSAPUUID),
      data: payload
    });
    return this._getCBOEntityByID(entityName, id) || this._getCBOEntityBySAPUUID(entityName, sSAPUUID);
  }

  async _deleteCBOEntity(entityName, id) {
    const sSAPUUID = await this._resolveCBOSAPUUIDByBusinessID(entityName, id);
    if (!sSAPUUID) {
      throw new Error(`Failed to resolve SAP_UUID for ${entityName} ID ${id}`);
    }
    await this._executeCBORequest({
      entityName,
      method: 'DELETE',
      path: this._buildCBOSAPUUIDPath(entityName, sSAPUUID)
    });
  }

  _buildGatePassItemCBOPayload(gatePassID, oItem = {}, index = 0) {
    return {
      ID: randomUUID(),
      gatePass_ID: gatePassID,
      materialCode: (oItem.materialCode || '').toString(),
      materialDescription: (oItem.materialDescription || '').toString(),
      quantity: Number(this._toNumber(oItem.quantity) || 0).toFixed(3),
      challanQuantity: oItem.challanQuantity === null || oItem.challanQuantity === undefined
        ? undefined
        : Number(this._toNumber(oItem.challanQuantity) || 0).toFixed(3),
      unitOfMeasure: (oItem.unitOfMeasure || '').toString() || undefined,
      batch: (oItem.batch || '').toString() || undefined,
      dateOfManufacture: this._toODataV2Date(oItem.dateOfManufacture),
      plant: (oItem.plant || '').toString() || undefined,
      orderItemNumber: (oItem.orderItemNumber || '').toString() || undefined
    };
  }

  async _replaceGatePassItemsForGatePass(gatePassID, aItems = []) {
    const sGatePassID = (gatePassID || '').toString().trim();
    if (!sGatePassID) {
      return;
    }
    const sFilter = `gatePass_ID eq '${this._escapeODataV2String(sGatePassID)}'`;
    const aExistingRows = await this._listCBOEntities('GatePassItems', { _queryOptions: { $filter: sFilter, $top: 5000 } }, 5000);
    for (const oRow of aExistingRows || []) {
      const sID = (oRow?.ID || oRow?.id || '').toString().trim();
      if (!sID) {
        continue;
      }
      try {
        await this._deleteCBOEntity('GatePassItems', sID);
      } catch (e) {
        // Continue with best-effort replacement if delete is not allowed by service config.
      }
    }
    for (let i = 0; i < (aItems || []).length; i += 1) {
      const oPayload = this._buildGatePassItemCBOPayload(sGatePassID, aItems[i], i);
      await this._createCBOEntity('GatePassItems', oPayload);
    }
  }

  _resolveIDFromRequest(req) {
    const sDataID = (req && req.data && req.data.ID) ? req.data.ID : '';
    if (sDataID) {
      return sDataID;
    }
    const oParam = req && Array.isArray(req.params) && req.params.length ? req.params[0] : null;
    return oParam && oParam.ID ? oParam.ID : '';
  }

  async _getAllGateEntriesRaw() {
    return this._listCBOEntities('GateEntries', { _queryOptions: { $top: 2000 } }, 2000);
  }

  async _findGateEntryByID(id) {
    const oRow = await this._getCBOEntityByID('GateEntries', id);
    return this._mapGateEntryFromCBO(oRow);
  }

  async _findGatePassByID(id) {
    const sID = (id || '').toString().trim();
    if (!sID) {
      return null;
    }
    const oMapped = this._mapGatePassFromCBO(await this._getCBOEntityByID('GatePasses', sID));
    if (oMapped) {
      const mItemsByPass = await this._loadGatePassItemsByGatePassIDs([oMapped.ID]);
      oMapped.items = mItemsByPass[oMapped.ID] || [];
      return oMapped;
    }
    const oEntry = await this._findGateEntryByID(sID);
    const oVirtualPass = this._buildVirtualGatePassFromEntry(oEntry);
    if (!oVirtualPass) {
      return null;
    }
    const mItemsByPass = await this._loadGatePassItemsByGatePassIDs([oVirtualPass.ID]);
    const aCBOItems = mItemsByPass[oVirtualPass.ID] || [];
    if (aCBOItems.length) {
      oVirtualPass.items = aCBOItems;
    }
    return oVirtualPass;
  }

  _mapGatePassFromCBO(oRow) {
    if (!oRow) {
      return null;
    }
    return {
      ID: oRow.ID || oRow.id || null,
      gatePassNumber: oRow.gatepassNumber || oRow.GatePassNumber || oRow.gatePassNumber || '',
      movementType: this._toMovementTypeFromCBO(oRow.movementType || oRow.MovementType),
      documentStatus: oRow.documentStatus || oRow.DocumentStatus || null,
      gateEntry_ID: oRow.gateEntry_ID || oRow.GateEntry_ID || null,
      gateEntryNumber: oRow.gateEntryNumber || oRow.GateEntryNumber || null,
      referenceType: oRow.referenceType || oRow.ReferenceType || null,
      referenceNumber: oRow.referenceNumber || oRow.ReferenceNumber || null,
      invoiceDate: this._fromODataV2Date(oRow.invoiceDate || oRow.InvoiceDate),
      invoiceValue: oRow.referenceNumber || oRow.ReferenceNumber || oRow.invoiceValue || oRow.InvoiceValue || null,
      partyNumber: oRow.partyNumber || oRow.PartyNumber || null,
      partyName: oRow.partyName || oRow.PartyName || null,
      eWayBillNumber: oRow.eWayBillNumber || oRow.EWayBillNumber || null,
      eWayBillDate: this._fromODataV2Date(oRow.eWayBillDate || oRow.EWayBillDate),
      shippingAddress: oRow.shippingAddress || oRow.ShippingAddress || null,
      vehicleNumber: oRow.vehicleNumber || oRow.VehicleNumber || null,
      vehicleType: oRow.vehicleType || oRow.VehicleType || null,
      transporterName: oRow.transporterName || oRow.TransporterName || null,
      driverName: oRow.driverName || oRow.DriverName || null,
      lrNumber: oRow.lrNumber || oRow.LrNumber || null,
      passDate: this._fromODataV2Date(oRow.passDate || oRow.PassDate),
      passTime: this._fromODataV2Duration(oRow.passTime || oRow.PassTime),
      remarks: oRow.remarks || oRow.Remarks || null
    };
  }

  _mapGatePassItemFromCBO(oRow) {
    if (!oRow) {
      return null;
    }
    return {
      ID: oRow.ID || oRow.id || null,
      gatePass_ID: oRow.gatePass_ID || oRow.GatePass_ID || null,
      itemNumber: Number.parseInt(oRow.itemNumber || oRow.ItemNumber || '', 10) || null,
      materialCode: oRow.materialCode || oRow.MaterialCode || null,
      materialDescription: oRow.materialDescription || oRow.MaterialDescription || null,
      quantity: this._toNumber(oRow.quantity || oRow.Quantity),
      challanQuantity: this._toNumber(oRow.challanQuantity || oRow.ChallanQuantity),
      unitOfMeasure: oRow.unitOfMeasure || oRow.UnitOfMeasure || null,
      batch: oRow.batch || oRow.Batch || null,
      dateOfManufacture: this._fromODataV2Date(oRow.dateOfManufacture || oRow.DateOfManufacture),
      plant: oRow.plant || oRow.Plant || null,
      orderItemNumber: oRow.orderItemNumber || oRow.OrderItemNumber || null
    };
  }

  _mapGateExitFromCBO(oRow) {
    if (!oRow) {
      return null;
    }
    return {
      ID: oRow.ID || oRow.id || null,
      gateExitNumber: oRow.gateExitNumber || oRow.GateExitNumber || null,
      gateEntry_ID: oRow.gateEntry_ID || oRow.GateEntry_ID || null,
      gateEntryNumber: oRow.gateEntryNumber || oRow.GateEntryNumber || null,
      gatePass_ID: oRow.gatePass_ID || oRow.GatePass_ID || null,
      gatePassNumber: oRow.gatePassNumber || oRow.GatePassNumber || null,
      exitDate: this._fromODataV2Date(oRow.exitDate || oRow.ExitDate),
      exitTime: this._fromODataV2Duration(oRow.exitTime || oRow.ExitTime),
      securityOfficer: oRow.securityOfficer || oRow.SecurityOfficer || null,
      remarks: oRow.remarks || oRow.Remarks || null
    };
  }

  _mapPlantFromCBO(oRow) {
    if (!oRow) {
      return null;
    }
    return {
      plantCode: oRow.plantCode || oRow.PlantCode || null,
      plantName: oRow.plantName || oRow.PlantName || null,
      location: oRow.location || oRow.Location || null,
      address: oRow.address || oRow.Address || null
    };
  }

  _parseMaterialItemsJson(sItemsJson) {
    if (!sItemsJson) {
      return [];
    }
    try {
      const parsed = JSON.parse(sItemsJson);
      return Array.isArray(parsed) ? parsed.map((oItem) => this._expandMaterialItemKeys(oItem)) : [];
    } catch (e) {
      return [];
    }
  }

  _expandMaterialItemKeys(oItem) {
    if (!oItem || typeof oItem !== 'object' || Array.isArray(oItem)) {
      return oItem;
    }
    const oExpanded = {};
    Object.entries(oItem).forEach(([sKey, vValue]) => {
      oExpanded[MATERIAL_ITEMS_KEY_MAP_REVERSE[sKey] || sKey] = vValue;
    });
    return oExpanded;
  }

  _shortenMaterialItemKeys(oItem) {
    const oShort = {};
    Object.entries(oItem || {}).forEach(([sKey, vValue]) => {
      oShort[MATERIAL_ITEMS_KEY_MAP[sKey] || sKey] = vValue;
    });
    return oShort;
  }

  // Expand a stored (possibly short-key) materialItemsJson string to full field names
  _expandMaterialItemsJsonString(vItemsJson) {
    if (!vItemsJson) {
      return vItemsJson || null;
    }
    try {
      const parsed = JSON.parse(vItemsJson);
      if (!Array.isArray(parsed)) {
        return vItemsJson;
      }
      return JSON.stringify(parsed.map((oItem) => this._expandMaterialItemKeys(oItem)));
    } catch (e) {
      return vItemsJson;
    }
  }

  // Single write choke point: parse + drop empty fields + short keys for the 500-char CBO field
  _compactMaterialItemsJsonForCBO(vItemsJson, vMovementType) {
    if (!vItemsJson) {
      return undefined;
    }
    const sMovementType = (vMovementType || '').toString().trim().toUpperCase();
    const bIsOutward = sMovementType === 'O' || sMovementType === 'OUT';
    return JSON.stringify(this._compactMaterialItemsForCBO(this._parseMaterialItemsJson(vItemsJson), bIsOutward));
  }

  // CBO materialItemsJson has a MaxLength facet — drop null/empty fields and,
  // for outward items, dateOfManufacture (not relevant) to stay within the limit
  _compactMaterialItemsForCBO(aItems, bIsOutward = false) {
    return (Array.isArray(aItems) ? aItems : []).map((oItem) => {
      const oCompact = {};
      Object.entries(oItem || {}).forEach(([sKey, vValue]) => {
        if (vValue === null || vValue === undefined || vValue === '') {
          return;
        }
        oCompact[sKey] = vValue;
      });
      if (bIsOutward) {
        delete oCompact.dateOfManufacture;
      }
      return this._shortenMaterialItemKeys(oCompact);
    });
  }

  _buildVirtualGatePassFromEntry(oEntry) {
    if (!oEntry || !oEntry.ID) {
      return null;
    }
    const aItems = this._parseMaterialItemsJson(oEntry.materialItemsJson).map((oItem, iIndex) => ({
      ID: randomUUID(),
      gatePass_ID: oEntry.ID,
      itemNumber: oItem.itemNumber || iIndex + 1,
      deliveryNumber: oItem.deliveryNumber || '',
      materialCode: oItem.materialCode || '',
      materialDescription: oItem.materialDescription || '',
      quantity: this._toNumber(oItem.quantity),
      challanQuantity: this._toNumber(oItem.challanQuantity),
      unitOfMeasure: oItem.unitOfMeasure || '',
      batch: oItem.batch || null,
      dateOfManufacture: oItem.dateOfManufacture || null,
      plant: oItem.plant || null,
      orderItemNumber: oItem.orderItemNumber || null
    }));
    return {
      ID: oEntry.ID,
      gatePassNumber: oEntry.gateEntryNumber ? `GP-${oEntry.gateEntryNumber}` : `GP-${oEntry.ID}`,
      movementType: oEntry.movementType || null,
      documentStatus: oEntry.documentStatus || null,
      gateEntry_ID: oEntry.ID,
      gateEntryNumber: oEntry.gateEntryNumber || null,
      referenceType: oEntry.referenceType || null,
      referenceNumber: oEntry.referenceNumber || null,
      invoiceDate: oEntry.invoiceDate || null,
      invoiceValue: oEntry.invoiceValue || oEntry.referenceNumber || null,
      partyNumber: oEntry.partyNumber || null,
      partyName: oEntry.partyName || null,
      eWayBillNumber: oEntry.eWayBillNumber || null,
      eWayBillDate: oEntry.eWayBillDate || null,
      shippingAddress: oEntry.shippingAddress || null,
      vehicleNumber: oEntry.vehicleNumber || null,
      vehicleType: oEntry.vehicleType || null,
      transporterName: oEntry.transporterName || null,
      driverName: oEntry.driverName || null,
      lrNumber: oEntry.lrNumber || null,
      passDate: oEntry.passDate || null,
      passTime: oEntry.passTime || null,
      remarks: oEntry.passRemarks || null,
      items: aItems
    };
  }

  async _onReadGateEntries(req) {
    const sID = this._resolveIDFromRequest(req);
    if (sID) {
      const oEntry = await this._findGateEntryByID(sID);
      return oEntry;
    }
    const aRows = await this._listCBOEntities('GateEntries', req, 2000);
    return aRows.map((oRow) => this._mapGateEntryFromCBO(oRow)).filter(Boolean);
  }

  async _onCreateGateEntry(req) {
    const oBasePayload = {
      ...req.data,
      ID: req.data.ID || randomUUID()
    };
    const bAutoGeneratedNumber = req.data._gateEntryNumberWasAutoGenerated !== false;
    const iMaxAttempts = bAutoGeneratedNumber ? 3 : 1;
    let oLastError = null;
    for (let iAttempt = 0; iAttempt < iMaxAttempts; iAttempt += 1) {
      const oPayload = {
        ...oBasePayload,
        ID: iAttempt === 0 ? oBasePayload.ID : randomUUID()
      };
      if (bAutoGeneratedNumber && iAttempt > 0) {
        // Recompute the next per-year sequence so concurrently created entries are picked up
        oPayload.gateEntryNumber = await this._getNextGateEntryNumber(oPayload.entryDate || new Date());
        oPayload._gateEntryNumberWasAutoGenerated = true;
      }
      try {
        const oCreated = await this._createCBOEntity('GateEntries', this._mapGateEntryToCBO(oPayload));
        return this._mapGateEntryFromCBO(oCreated) || this._findGateEntryByID(oPayload.ID);
      } catch (e) {
        oLastError = e;
        const bIsDuplicate = this._isDuplicateCBOCreateError(e);
        const bCanRetry = bAutoGeneratedNumber && iAttempt < (iMaxAttempts - 1) && bIsDuplicate;
        if (!bCanRetry) {
          if (bIsDuplicate) {
            const oExisting = await this._findExistingGateEntryForCreatePayload(oPayload);
            if (oExisting) {
              cds.log('gatepass-create').warn(`Duplicate GateEntry create avoided by returning existing record ID=${oExisting.ID}, gateEntryNumber=${oExisting.gateEntryNumber || ''}`);
              return oExisting;
            }
          }
          this._logRemoteErrorDetails(cds.log('gatepass-create'), 'S/4 GateEntry create failed', e);
          throw e;
        }
      }
    }
    throw oLastError || new Error('Failed to create Gate Entry');
  }

  async _onUpdateGateEntry(req) {
    const sID = this._resolveIDFromRequest(req);
    if (!sID) {
      return req.error(400, 'Gate Entry ID is required for update');
    }
    const oExisting = await this._findGateEntryByID(sID);
    if (!oExisting) {
      return req.error(404, 'Gate Entry not found');
    }
    const oMerged = { ...oExisting, ...req.data, ID: sID };
    if (!this._isValidGateEntryNumberForCBO(oMerged.gateEntryNumber)) {
      const sInvalidGateEntryNumber = oMerged.gateEntryNumber;
      oMerged.gateEntryNumber = await this._getNextGateEntryNumber(oMerged.entryDate || oExisting.entryDate || new Date());
      cds.log('gatepass-update').warn(`Replacing invalid GateEntryNumber before PATCH for ID=${sID}: ${sInvalidGateEntryNumber} -> ${oMerged.gateEntryNumber}`);
    }
    const oPayload = this._mapGateEntryToCBO(oMerged, true);
    const oUpdated = await this._updateCBOEntity('GateEntries', sID, oPayload);
    return this._mapGateEntryFromCBO(oUpdated) || this._findGateEntryByID(sID);
  }

  async _loadGatePassItemsByGatePassIDs(aPassIDs) {
    const aIDs = Array.isArray(aPassIDs) ? aPassIDs.filter(Boolean) : [];
    if (!aIDs.length) {
      return {};
    }
    const sFilter = aIDs
      .map((sID) => `gatePass_ID eq '${this._escapeODataV2String(sID)}'`)
      .join(' or ');
    const oReq = { _queryOptions: { $filter: sFilter, $top: 5000 } };
    const aRows = await this._listCBOEntities('GatePassItems', oReq, 5000);
    return aRows.reduce((mAcc, oRow) => {
      const oMapped = this._mapGatePassItemFromCBO(oRow);
      const sPassID = oMapped?.gatePass_ID;
      if (!sPassID) {
        return mAcc;
      }
      mAcc[sPassID] = mAcc[sPassID] || [];
      mAcc[sPassID].push(oMapped);
      return mAcc;
    }, {});
  }

  async _onReadGatePasses(req) {
    const sID = this._resolveIDFromRequest(req);
    if (sID) {
      const oPass = await this._findGatePassByID(sID);
      if (oPass) {
        return oPass;
      }
      const oEntry = await this._findGateEntryByID(sID);
      return this._buildVirtualGatePassFromEntry(oEntry);
    }
    const aRows = await this._listCBOEntities('GatePasses', req, 2000);
    const aMapped = aRows.map((oRow) => this._mapGatePassFromCBO(oRow)).filter(Boolean);
    if (aMapped.length > 0) {
      const mItemsByPass = await this._loadGatePassItemsByGatePassIDs(aMapped.map((oPass) => oPass.ID));
      aMapped.forEach((oPass) => {
        oPass.items = mItemsByPass[oPass.ID] || [];
      });
      return aMapped;
    }
    const aEntryRows = await this._listCBOEntities('GateEntries', req, 2000);
    const aVirtualPasses = aEntryRows
      .map((oRow) => this._mapGateEntryFromCBO(oRow))
      .filter((oEntry) => oEntry && oEntry.documentStatus === 'C' && oEntry.entryStatus !== 'CLOSED')
      .map((oEntry) => this._buildVirtualGatePassFromEntry(oEntry))
      .filter(Boolean);
    if (!aVirtualPasses.length) {
      return [];
    }
    const mItemsByPass = await this._loadGatePassItemsByGatePassIDs(aVirtualPasses.map((oPass) => oPass.ID));
    aVirtualPasses.forEach((oPass) => {
      const aCBOItems = mItemsByPass[oPass.ID] || [];
      if (aCBOItems.length) {
        oPass.items = aCBOItems;
      }
    });
    return aVirtualPasses;
  }

  async _onReadGatePassItems(req) {
    const sID = this._resolveIDFromRequest(req);
    if (sID) {
      const oRow = await this._getCBOEntityByID('GatePassItems', sID);
      return this._mapGatePassItemFromCBO(oRow);
    }
    const aRows = await this._listCBOEntities('GatePassItems', req, 5000);
    return aRows.map((oRow) => this._mapGatePassItemFromCBO(oRow)).filter(Boolean);
  }

  async _onReadGateExit(req) {
    const sID = this._resolveIDFromRequest(req);
    if (sID) {
      const oRow = await this._getCBOEntityByID('GateExit', sID);
      return this._mapGateExitFromCBO(oRow);
    }
    const aRows = await this._listCBOEntities('GateExit', req, 2000);
    return aRows.map((oRow) => this._mapGateExitFromCBO(oRow)).filter(Boolean);
  }

  async _onReadPlants(req) {
    const aRows = await this._listCBOEntities('Plants', req, 1000);
    return aRows.map((oRow) => this._mapPlantFromCBO(oRow)).filter(Boolean);
  }

  async _applyCurrentYearReceivedQuantities(poNumber, rows, req) {
    const sPONumber = (poNumber || '').toString().trim();
    const aRows = Array.isArray(rows) ? rows : [];
    if (!sPONumber || !aRows.length) {
      return aRows;
    }
    const nCurrentYear = this._getCurrentGRYear();
    const mReceivedByKey = await this._getGRTrackerQuantitiesByPOAndYear(sPONumber, nCurrentYear, req);
    if (!Object.keys(mReceivedByKey).length) {
      return aRows;
    }
    return aRows.map((oRow) => {
      const sItemNumber = this._normalizePOItemNumber(this._pickFirstValue(oRow, ['item_no', 'PurchaseOrderItem', 'purchaseOrderItem']) || '');
      const sPOUnit = this._normalizeUnitOfMeasure(
        this._pickFirstValue(oRow, ['purchase_order_quantity_unit', 'PurchaseOrderQuantityUnit', 'purchaseOrderQuantityUnit']) || ''
      );
      const nOriginalQty = this._toNumber(this._pickFirstValue(oRow, ['po_qty', 'OrderQuantity', 'orderQuantity', 'quantity']));
      if (!sItemNumber || !sPOUnit) {
        return oRow;
      }
      const sTrackerKey = this._buildGRTrackerKey(sItemNumber, sPOUnit);
      if (!Object.prototype.hasOwnProperty.call(mReceivedByKey, sTrackerKey)) {
        return oRow;
      }
      return {
        ...oRow,
        po_qty: mReceivedByKey[sTrackerKey] || 0,
        original_po_qty: nOriginalQty
      };
    });
  }

  _toODataV2DateTime(value) {
    const oDate = value instanceof Date ? value : new Date(value);
    const nTimestamp = Number.isNaN(oDate.getTime()) ? Date.now() : oDate.getTime();
    return `/Date(${nTimestamp})/`;
  }

  _formatPOItemForMaterialDoc(vValue) {
    const sRaw = (vValue || '').toString().trim();
    if (!sRaw) {
      return '';
    }
    const sDigits = sRaw.replace(/[^0-9]/g, '');
    if (!sDigits) {
      return sRaw;
    }
    const nParsed = Number.parseInt(sDigits, 10);
    if (Number.isFinite(nParsed)) {
      return String(nParsed);
    }
    return sDigits;
  }

  _parseGateEntryNumber(vGateEntryNumber) {
    const sValue = (vGateEntryNumber || '').toString().trim().toUpperCase();
    if (!sValue) {
      return { year: null, sequence: 0 };
    }
    // Current format: GE-YYYY-<SeqNo> — sequence restarts from 000001 each year
    let oMatch = sValue.match(/^GE-(\d{4})-(\d+)$/);
    if (oMatch) {
      return {
        year: Number.parseInt(oMatch[1], 10),
        sequence: Number.parseInt(oMatch[2], 10) || 0
      };
    }
    // Legacy format: GE-<SeqNo>-<YYYYMMDD> — year taken from the date suffix
    oMatch = sValue.match(/^GE-(\d+)-(\d{4})\d{4}$/);
    if (oMatch) {
      return {
        year: Number.parseInt(oMatch[2], 10),
        sequence: Number.parseInt(oMatch[1], 10) || 0
      };
    }
    // Legacy formats without any year: GE-<SeqNo> or GE<SeqNo>
    oMatch = sValue.match(/^GE-?(\d+)$/);
    if (oMatch) {
      return { year: null, sequence: Number.parseInt(oMatch[1], 10) || 0 };
    }
    return { year: null, sequence: 0 };
  }

  _resolveGateEntryYear(vDateLike) {
    const sNormalized = this._normalizeDate(vDateLike);
    if (this._isNormalizedDate(sNormalized)) {
      return Number.parseInt(sNormalized.slice(0, 4), 10);
    }
    return new Date().getFullYear();
  }

  _buildGateEntryNumber(nSequence, vDateLike) {
    const nNormalized = Number.parseInt(nSequence, 10);
    const nSafeSequence = Number.isFinite(nNormalized) && nNormalized > 0
      ? nNormalized
      : 1;
    const nYear = this._resolveGateEntryYear(vDateLike);
    return `GE-${nYear}-${String(nSafeSequence).padStart(6, '0')}`;
  }

  async _getNextGateEntryNumber(vDateLike) {
    const vEffectiveDate = vDateLike || new Date();
    const nTargetYear = this._resolveGateEntryYear(vEffectiveDate);
    const aExistingRows = await this._getAllGateEntriesRaw();
    const nLastSeq = (aExistingRows || []).reduce((nMax, oRow) => {
      const oParsed = this._parseGateEntryNumber(oRow?.GateEntryNumber || oRow?.gateEntryNumber);
      if (oParsed.year !== nTargetYear) {
        return nMax;
      }
      return oParsed.sequence > nMax ? oParsed.sequence : nMax;
    }, 0);
    return this._buildGateEntryNumber(nLastSeq + 1, vEffectiveDate);
  }

  _isValidGateEntryNumberForCBO(vGateEntryNumber) {
    const sValue = (vGateEntryNumber || '').toString().trim().toUpperCase();
    if (!sValue || sValue.length > 20) {
      return false;
    }
    // Current format: GE-YYYY-<SeqNo>
    if (/^GE-\d{4}-\d{6}$/.test(sValue)) {
      return true;
    }
    // Legacy formats remain valid so historical records are not regenerated
    return /^GE-\d{6}-\d{8}$/.test(sValue) || /^GE-?\d{6}$/.test(sValue);
  }

  _isDuplicateCBOCreateError(error) {
    const sCode = this._getRemoteErrorCode(error);
    if ((sCode || '').toString().trim() === '/BOBF/FRW_COMMON/141') {
      return true;
    }
    const sMessage = (this._getRemoteErrorMessage(error) || error?.message || '').toString();
    return /same key already exists/i.test(sMessage);
  }

  _normalizeGateEntryKeyValue(vValue) {
    return (vValue || '').toString().trim().toUpperCase();
  }

  async _findExistingGateEntryForCreatePayload(oPayload = {}) {
    const sEntryDate = this._normalizeDate(oPayload.entryDate);
    const sMovementType = this._normalizeGateEntryKeyValue(this._toMovementTypeForCBO(oPayload.movementType));
    const sReferenceType = this._normalizeGateEntryKeyValue(oPayload.referenceType);
    const sReferenceNumber = this._normalizeGateEntryKeyValue(oPayload.referenceNumber);
    const sVehicleNumber = this._normalizeGateEntryKeyValue(oPayload.vehicleNumber);
    const sVehicleType = this._normalizeGateEntryKeyValue(oPayload.vehicleType);
    const sTransporterName = this._normalizeGateEntryKeyValue(oPayload.transporterName);
    const sDriverName = this._normalizeGateEntryKeyValue(oPayload.driverName);
    const aRows = await this._getAllGateEntriesRaw();
    const oMatched = (aRows || []).find((oRow) => {
      const sRowEntryDate = this._normalizeDate(oRow?.entryDate || oRow?.EntryDate);
      const sRowMovementType = this._normalizeGateEntryKeyValue(oRow?.movementType || oRow?.MovementType);
      const sRowReferenceType = this._normalizeGateEntryKeyValue(oRow?.referenceType || oRow?.ReferenceType);
      const sRowReferenceNumber = this._normalizeGateEntryKeyValue(oRow?.referenceNumber || oRow?.ReferenceNumber);
      const sRowVehicleNumber = this._normalizeGateEntryKeyValue(oRow?.vehicleNumber || oRow?.VehicleNumber);
      const sRowVehicleType = this._normalizeGateEntryKeyValue(oRow?.vehicleType || oRow?.VehicleType);
      const sRowTransporterName = this._normalizeGateEntryKeyValue(oRow?.transporterName || oRow?.TransporterName);
      const sRowDriverName = this._normalizeGateEntryKeyValue(oRow?.driverName || oRow?.DriverName);
      return (
        sRowEntryDate === sEntryDate &&
        sRowMovementType === sMovementType &&
        sRowReferenceType === sReferenceType &&
        sRowReferenceNumber === sReferenceNumber &&
        sRowVehicleNumber === sVehicleNumber &&
        sRowVehicleType === sVehicleType &&
        sRowTransporterName === sTransporterName &&
        sRowDriverName === sDriverName
      );
    });
    return this._mapGateEntryFromCBO(oMatched) || null;
  }

  _isNormalizedDate(vValue) {
    const sValue = (vValue || '').toString().trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(sValue)) {
      return false;
    }
    const [sYear, sMonth, sDay] = sValue.split('-');
    const nYear = Number.parseInt(sYear, 10);
    const nMonth = Number.parseInt(sMonth, 10);
    const nDay = Number.parseInt(sDay, 10);
    if (!Number.isInteger(nYear) || !Number.isInteger(nMonth) || !Number.isInteger(nDay)) {
      return false;
    }
    const oDate = new Date(`${sValue}T00:00:00`);
    if (Number.isNaN(oDate.getTime())) {
      return false;
    }
    return (
      oDate.getFullYear() === nYear &&
      oDate.getMonth() + 1 === nMonth &&
      oDate.getDate() === nDay
    );
  }

  _isNormalizedTime(vValue) {
    const sValue = (vValue || '').toString().trim();
    const oMatch = sValue.match(/^(\d{2}):(\d{2}):(\d{2})$/);
    if (!oMatch) {
      return false;
    }
    const nHours = Number.parseInt(oMatch[1], 10);
    const nMinutes = Number.parseInt(oMatch[2], 10);
    const nSeconds = Number.parseInt(oMatch[3], 10);
    return (
      nHours >= 0 &&
      nHours < 24 &&
      nMinutes >= 0 &&
      nMinutes < 60 &&
      nSeconds >= 0 &&
      nSeconds < 60
    );
  }

  _toDateTime(sDate, sTime) {
    if (!this._isNormalizedDate(sDate) || !this._isNormalizedTime(sTime)) {
      return null;
    }
    const oDate = new Date(`${sDate}T${sTime}`);
    return Number.isNaN(oDate.getTime()) ? null : oDate;
  }

  _toDateTimeWithClientOffset(sDate, sTime, nClientTimezoneOffsetMinutes) {
    if (!this._isNormalizedDate(sDate) || !this._isNormalizedTime(sTime)) {
      return null;
    }
    if (!Number.isInteger(nClientTimezoneOffsetMinutes)) {
      return this._toDateTime(sDate, sTime);
    }
    const [sYear, sMonth, sDay] = sDate.split('-');
    const [sHours, sMinutes, sSeconds] = sTime.split(':');
    const nUtcMillis = Date.UTC(
      Number.parseInt(sYear, 10),
      Number.parseInt(sMonth, 10) - 1,
      Number.parseInt(sDay, 10),
      Number.parseInt(sHours, 10),
      Number.parseInt(sMinutes, 10),
      Number.parseInt(sSeconds, 10),
      0
    ) + (nClientTimezoneOffsetMinutes * 60 * 1000);
    const oDate = new Date(nUtcMillis);
    return Number.isNaN(oDate.getTime()) ? null : oDate;
  }

  _getExitFutureToleranceMs() {
    const nConfigured = Number.parseInt(process.env.GATE_EXIT_FUTURE_TOLERANCE_MS || '', 10);
    if (Number.isInteger(nConfigured) && nConfigured >= 0) {
      return nConfigured;
    }
    return 120000;
  }

  _toNumber(vValue) {
    const nValue = Number(vValue);
    return Number.isFinite(nValue) ? nValue : null;
  }

  _normalizeUnitOfMeasure(vValue) {
    return (vValue || '').toString().trim().toUpperCase();
  }

  _getCurrentGRYear() {
    return new Date().getFullYear();
  }

  _buildGRTrackerKey(sItemNumber, sUnitOfMeasure) {
    return `${sItemNumber}::${sUnitOfMeasure}`;
  }

  async _getGRTrackerQuantitiesByPOAndYear(poNumber, grYear, req) {
    const sPONumber = (poNumber || '').toString().trim();
    const nGRYear = Number.parseInt(grYear, 10);
    if (!sPONumber || !Number.isInteger(nGRYear)) {
      return {};
    }
    try {
      const aRows = await this._fetchS4MaterialDocumentItemsByPO(sPONumber, req);
      const mRawByKey = (aRows || []).reduce((mAcc, oRow) => {
        const nRowYear = this._resolveMaterialDocumentYear(oRow);
        if (nRowYear !== nGRYear) {
          return mAcc;
        }
        const sItemNumber = this._normalizePOItemNumber(
          this._pickFirstValue(oRow, ['PurchaseOrderItem', 'purchaseOrderItem']) || ''
        );
        const sUnit = this._normalizeUnitOfMeasure(
          this._pickFirstValue(oRow, ['EntryUnit', 'entryUnit']) || ''
        );
        const nSignedQty = this._resolveSignedMaterialDocumentQuantity(oRow);
        if (!sItemNumber || !sUnit || nSignedQty === 0) {
          return mAcc;
        }
        const sKey = this._buildGRTrackerKey(sItemNumber, sUnit);
        mAcc[sKey] = (mAcc[sKey] || 0) + nSignedQty;
        return mAcc;
      }, {});
      return Object.entries(mRawByKey).reduce((mAcc, [sKey, nValue]) => {
        const nRounded = Number((nValue || 0).toFixed(3));
        if (nRounded > 0) {
          mAcc[sKey] = nRounded;
        }
        return mAcc;
      }, {});
    } catch (e) {
      cds.log('gatepass-po').warn(`S/4 GR tracker lookup failed for PO ${sPONumber}. Returning empty tracker. ${e.message}`);
      return {};
    }
  }

  async _applyCurrentYearResidualQuantities(poNumber, rows, req) {
    const sPONumber = (poNumber || '').toString().trim();
    const aRows = Array.isArray(rows) ? rows : [];
    if (!sPONumber || !aRows.length) {
      return aRows;
    }
    const nCurrentYear = this._getCurrentGRYear();
    const mReceivedByKey = await this._getGRTrackerQuantitiesByPOAndYear(sPONumber, nCurrentYear, req);
    if (!Object.keys(mReceivedByKey).length) {
      return aRows;
    }
    return aRows.map((oRow) => {
      const sItemNumber = this._normalizePOItemNumber(this._pickFirstValue(oRow, ['item_no', 'PurchaseOrderItem', 'purchaseOrderItem']) || '');
      const sPOUnit = this._normalizeUnitOfMeasure(
        this._pickFirstValue(oRow, ['purchase_order_quantity_unit', 'PurchaseOrderQuantityUnit', 'purchaseOrderQuantityUnit']) || ''
      );
      const nPOQty = this._toNumber(this._pickFirstValue(oRow, ['po_qty', 'OrderQuantity', 'orderQuantity', 'quantity']));
      if (!sItemNumber || !sPOUnit || nPOQty === null) {
        return oRow;
      }
      const sTrackerKey = this._buildGRTrackerKey(sItemNumber, sPOUnit);
      const nReceived = mReceivedByKey[sTrackerKey] || 0;
      const nResidual = Math.max(0, nPOQty - nReceived);
      return {
        ...oRow,
        po_qty: nResidual
      };
    });
  }


  async _resolveGRStorageLocation(oOpenItem, sDefaultStorageLocation, req) {
    const sProvided = (
      oOpenItem?.storageLocation ||
      sDefaultStorageLocation ||
      ''
    ).toString().trim();
    if (sProvided) {
      return sProvided;
    }
    const sMaterial = (oOpenItem?.material || '').toString().trim();
    const sPlant = (oOpenItem?.plant || '').toString().trim();
    if (!sMaterial || !sPlant) {
      return '';
    }
    return this._fetchRecentStorageLocation(sMaterial, sPlant, req);
  }

  async _fetchRecentStorageLocation(material, plant, req) {
    const sMaterial = (material || '').toString().trim();
    const sPlant = (plant || '').toString().trim();
    if (!sMaterial || !sPlant) {
      return '';
    }
    const oGRService = await this._getGRService();
    const oRemoteClient = req ? oGRService.tx(req) : oGRService;
    const sGRServiceRoot = this._getGRServiceRoot();
    const sFilter = `Material eq '${this._escapeODataString(sMaterial)}' and Plant eq '${this._escapeODataString(sPlant)}'`;
    const sPath = this._buildS4Path(
      sGRServiceRoot,
      `/A_MaterialDocumentItem?$filter=${sFilter}&$select=StorageLocation&$top=20&$format=json`
    );
    const oResponse = await oRemoteClient.send({
      method: 'GET',
      path: sPath
    });
    const oPayload = this._unwrapODataPayload(oResponse);
    const aRows = this._normalizeCollection(oPayload);
    for (const oRow of aRows) {
      const sStorageLocation = (oRow?.StorageLocation || oRow?.storageLocation || '').toString().trim();
      if (sStorageLocation) {
        return sStorageLocation;
      }
    }
    return '';
  }

  _readDestinationOverrideFromCDSConfig() {
    const sRaw = process.env.CDS_CONFIG;
    if (!sRaw) {
      return { po: '', gr: '', billing: '' };
    }
    try {
      const oCfg = JSON.parse(sRaw);
      return {
        po: (((oCfg || {}).requires || {}).purchaseorder_api || {}).credentials?.destination || '',
        gr: (((oCfg || {}).requires || {}).goodsreceipt_api || {}).credentials?.destination || '',
        billing: (((oCfg || {}).requires || {}).billingdocument_api || {}).credentials?.destination || ''
      };
    } catch (e) {
      cds.log('gatepass-s4').warn(`Could not parse CDS_CONFIG for destination harmonization: ${e.message}`);
      return { po: '', gr: '', billing: '' };
    }
  }

  _harmonizeS4Destinations() {
    const oRequires = cds.env?.requires || {};
    oRequires.purchaseorder_api = oRequires.purchaseorder_api || { kind: 'odata-v4', credentials: {} };
    oRequires.purchaseorder_api.credentials = oRequires.purchaseorder_api.credentials || {};
    oRequires.goodsreceipt_api = oRequires.goodsreceipt_api || { kind: 'odata-v2', credentials: {} };
    oRequires.goodsreceipt_api.credentials = oRequires.goodsreceipt_api.credentials || {};
    oRequires.billingdocument_api = oRequires.billingdocument_api || { kind: 'odata-v4', credentials: {} };
    oRequires.billingdocument_api.credentials = oRequires.billingdocument_api.credentials || {};

    const oOverride = this._readDestinationOverrideFromCDSConfig();
    const sSharedEnvDestination = (process.env.S4_DESTINATION || process.env.S4_API_DESTINATION || '').toString().trim();

    if (sSharedEnvDestination) {
      oRequires.purchaseorder_api.credentials.destination = sSharedEnvDestination;
      oRequires.goodsreceipt_api.credentials.destination = sSharedEnvDestination;
      oRequires.billingdocument_api.credentials.destination = sSharedEnvDestination;
      cds.log('gatepass-s4').info(`Applied shared S4 destination ${sSharedEnvDestination} to purchaseorder_api, goodsreceipt_api and billingdocument_api.`);
      return;
    }

    if (oOverride.po && !oOverride.gr && !oOverride.billing) {
      oRequires.goodsreceipt_api.credentials.destination = oOverride.po;
      oRequires.billingdocument_api.credentials.destination = oOverride.po;
      cds.log('gatepass-s4').info(`Mirrored purchaseorder_api destination ${oOverride.po} to goodsreceipt_api and billingdocument_api.`);
      return;
    }
    if (oOverride.gr && !oOverride.po && !oOverride.billing) {
      oRequires.purchaseorder_api.credentials.destination = oOverride.gr;
      oRequires.billingdocument_api.credentials.destination = oOverride.gr;
      cds.log('gatepass-s4').info(`Mirrored goodsreceipt_api destination ${oOverride.gr} to purchaseorder_api and billingdocument_api.`);
      return;
    }
    if (oOverride.billing && !oOverride.po && !oOverride.gr) {
      oRequires.purchaseorder_api.credentials.destination = oOverride.billing;
      oRequires.goodsreceipt_api.credentials.destination = oOverride.billing;
      cds.log('gatepass-s4').info(`Mirrored billingdocument_api destination ${oOverride.billing} to purchaseorder_api and goodsreceipt_api.`);
      return;
    }

    const sPOConfigured = (oRequires.purchaseorder_api.credentials.destination || '').toString().trim();
    const sGRConfigured = (oRequires.goodsreceipt_api.credentials.destination || '').toString().trim();
    const sBillingConfigured = (oRequires.billingdocument_api.credentials.destination || '').toString().trim();
    const sFallback = sPOConfigured || sGRConfigured || sBillingConfigured;
    if (!sFallback) {
      return;
    }
    if (!sPOConfigured) {
      oRequires.purchaseorder_api.credentials.destination = sFallback;
    }
    if (!sGRConfigured) {
      oRequires.goodsreceipt_api.credentials.destination = sFallback;
    }
    if (!sBillingConfigured) {
      oRequires.billingdocument_api.credentials.destination = sFallback;
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
    return this._normalizeServiceRoot(sConfigured, '/sap/opu/odata4/sap/api_purchaseorder_2/srvd_a2x/sap/purchaseorder/0001');
  }

  _getGRServiceRoot() {
    const sConfigured = process.env.S4_GR_SERVICE_ROOT ||
      cds.env?.requires?.goodsreceipt_api?.serviceRoot;
    return this._normalizeServiceRoot(sConfigured, '/sap/opu/odata/sap/API_MATERIAL_DOCUMENT_SRV');
  }

  _getBillingServiceRoot() {
    const sConfigured = process.env.S4_BILLING_SERVICE_ROOT ||
      cds.env?.requires?.billingdocument_api?.serviceRoot;
    return this._normalizeServiceRoot(sConfigured, '/sap/opu/odata4/sap/api_billingdocument/srvd_a2x/sap/billingdocument/0001');
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
      error?.response?.data?.error?.code ||
      error?.response?.body?.error?.code ||
      error?.reason?.code ||
      error?.code ||
      ''
    ).toString();
  }

  _getRemoteErrorPayload(error) {
    return (
      error?.reason?.response?.body ||
      error?.response?.body ||
      error?.response?.data ||
      null
    );
  }

  _getRemoteErrorMessage(error) {
    const vMessage = (
      error?.reason?.response?.body?.error?.message?.value ||
      error?.reason?.response?.body?.error?.message ||
      error?.response?.data?.error?.message?.value ||
      error?.response?.data?.error?.message ||
      error?.response?.body?.error?.message?.value ||
      error?.response?.body?.error?.message ||
      (typeof error?.response?.data === 'string' ? error.response.data : '') ||
      error?.reason?.message ||
      error?.message ||
      ''
    );
    if (typeof vMessage === 'string') {
      return vMessage.trim();
    }
    return String(vMessage || '').trim();
  }
  _isCsrfValidationError(error) {
    const sMessage = this._getRemoteErrorMessage(error).toLowerCase();
    if (sMessage.includes('csrf token validation failed')) {
      return true;
    }
    const sBody = JSON.stringify(error?.reason?.response?.body || error?.response?.body || error?.response?.data || '').toLowerCase();
    return sBody.includes('csrf token validation failed');
  }

  _isRemoteAuthorizationError(error) {
    if (this._isCsrfValidationError(error)) {
      return false;
    }
    const iStatus = this._getRemoteErrorStatus(error);
    if (iStatus === 401) {
      return true;
    }

    const sCode = this._getRemoteErrorCode(error);
    if (
      sCode.includes('/IWBEP/CM_V4_COS/011') ||
      sCode.includes('/IWBEP/CM_MGW_RT/000') ||
      sCode.includes('/IWBEP/CM_MGW_RT/027')
    ) {
      return true;
    }

    const sMessage = this._getRemoteErrorMessage(error).toLowerCase();
    if (sMessage.includes('no authorization') || sMessage.includes('not authorized') || sMessage.includes('start authorization')) {
      return true;
    }
    return iStatus === 403 && sMessage.includes('authorization');
  }

  _isRemoteBusinessValidationError(error) {
    const iStatus = this._getRemoteErrorStatus(error);
    if (iStatus !== 400) {
      return false;
    }
    if (this._isRemoteAuthorizationError(error)) {
      return false;
    }
    return !!(this._getRemoteErrorPayload(error) || this._getRemoteErrorMessage(error));
  }

  _logRemoteErrorDetails(oLog, sContext, error) {
    const sCode = this._getRemoteErrorCode(error);
    const sMessage = this._getRemoteErrorMessage(error) || error?.message || 'Unknown remote error';
    const iStatus = this._getRemoteErrorStatus(error);
    oLog.error(`${sContext} (status=${iStatus || 'n/a'}, code=${sCode || 'n/a'}): ${sMessage}`);
    const oPayload = this._getRemoteErrorPayload(error);
    if (oPayload) {
      oLog.error(JSON.stringify(oPayload));
    }
  }

  _buildS4BusinessValidationErrorMessage() {
    return 'S/4 Business Validation Failed, Contact Support';
  }

  _buildGRAuthorizationErrorMessage(error) {
    const sUpstreamMessage = this._getRemoteErrorMessage(error);
    if (sUpstreamMessage) {
      return `S/4 authorization error for API_MATERIAL_DOCUMENT_SRV: ${sUpstreamMessage}`;
    }
    return 'S/4 authorization error for API_MATERIAL_DOCUMENT_SRV. Please assign required authorizations and retry.';
  }

  _buildPOAuthorizationErrorMessage(error) {
    const sUpstreamMessage = this._getRemoteErrorMessage(error);
    if (sUpstreamMessage) {
      return `S/4 authorization error for API_PURCHASEORDER_2: ${sUpstreamMessage}`;
    }
    return 'S/4 authorization error for API_PURCHASEORDER_2. Please assign required authorizations and retry.';
  }

  _buildSIAuthorizationErrorMessage(error) {
    const sUpstreamMessage = this._getRemoteErrorMessage(error);
    if (sUpstreamMessage) {
      return `S/4 authorization error for API_BILLINGDOCUMENT: ${sUpstreamMessage}`;
    }
    return 'S/4 authorization error for API_BILLINGDOCUMENT. Please assign required authorizations and retry.';
  }

  /**
   * Before CREATE Gate Entry — generate number, validate mandatory fields
   */
  async _onBeforeCreateGateEntry(req) {
    const data = req.data;

    // Normalize date/time payloads (supports localized UI values like 5/9/26, 12:10:28 AM)
    data.entryDate = this._normalizeDate(data.entryDate);
    data.entryTime = this._normalizeTime(data.entryTime);
    if (!data.entryTime) {
      data.entryTime = this._getCurrentTimeHHMMSS();
    }

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

    // Set Gate Entry Year from Entry Date if not provided (sequence restarts every year)
    if (!data.gateEntryYear) {
      data.gateEntryYear = this._resolveGateEntryYear(data.entryDate || new Date());
    }
    data.gateEntryYear = String(data.gateEntryYear);
    if (!data.documentStatus) {
      data.documentStatus = 'OPEN';
    }
    if (!data.entryStatus) {
      data.entryStatus = 'CREATED';
    }
    const sProvidedGateEntryNumber = (data.gateEntryNumber || '').toString().trim();
    const bHasValidProvidedGateEntryNumber = this._isValidGateEntryNumberForCBO(sProvidedGateEntryNumber);
    if (bHasValidProvidedGateEntryNumber) {
      data.gateEntryNumber = sProvidedGateEntryNumber.toUpperCase();
      data._gateEntryNumberWasAutoGenerated = false;
    } else {
      if (sProvidedGateEntryNumber) {
        cds.log('gatepass-create').warn(`Ignoring invalid GateEntryNumber from request: ${sProvidedGateEntryNumber}`);
      }
      data.gateEntryNumber = await this._getNextGateEntryNumber(data.entryDate);
      data._gateEntryNumberWasAutoGenerated = true;
    }

    // Auto-populate from PO or Invoice
    if (data.movementType === 'O') {
      data.referenceType = 'SI';
      data.referenceNumber = (data.referenceNumber || '').toString().trim();
      if (!data.referenceNumber) {
        return req.error(400, 'Reference Number (Invoice) is mandatory for Outward movement');
      }
    }
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
      try {
        const oInvoiceSnapshot = await this._fetchSalesInvoiceDetails(data.referenceNumber, req, {
          gateEntryID: data.ID || null,
          preferLocal: false,
          persistSnapshot: false
        });
        if (oInvoiceSnapshot) {
          this._applySalesInvoiceSnapshotToGateEntryData(data, oInvoiceSnapshot);
        }
      } catch (e) {
        if (this._isRemoteAuthorizationError(e)) {
          return req.reject(403, this._buildSIAuthorizationErrorMessage(e));
        }
        if (this._isRemoteBusinessValidationError(e)) {
          return req.reject(400, this._buildS4BusinessValidationErrorMessage());
        }
        throw e;
      }
    }
  }

  /**
   * Before UPDATE Gate Entry — prevent edit if already closed or exited
   */
  async _onBeforeUpdateGateEntry(req) {
    const data = req.data || {};
    if (Object.prototype.hasOwnProperty.call(data, 'entryTime')) {
      data.entryTime = this._normalizeTime(data.entryTime);
      if (!data.entryTime) {
        data.entryTime = this._getCurrentTimeHHMMSS();
      }
    }
    const ID = this._resolveIDFromRequest(req);
    const entry = await this._findGateEntryByID(ID);
    if (entry && (entry.entryStatus === 'EXITED' || entry.entryStatus === 'CANCELLED')) {
      return req.error(400, 'Cannot modify a Gate Entry that is already exited or cancelled');
    }
    const sIncomingGateEntryNumber = Object.prototype.hasOwnProperty.call(data, 'gateEntryNumber')
      ? (data.gateEntryNumber || '').toString().trim()
      : '';
    if (sIncomingGateEntryNumber) {
      if (this._isValidGateEntryNumberForCBO(sIncomingGateEntryNumber)) {
        data.gateEntryNumber = sIncomingGateEntryNumber.toUpperCase();
      } else {
        data.gateEntryNumber = await this._getNextGateEntryNumber(data.entryDate || entry?.entryDate || new Date());
        cds.log('gatepass-update').warn(`Replacing invalid GateEntryNumber from update payload: ${sIncomingGateEntryNumber} -> ${data.gateEntryNumber}`);
      }
    } else if (entry && !this._isValidGateEntryNumberForCBO(entry.gateEntryNumber)) {
      data.gateEntryNumber = await this._getNextGateEntryNumber(data.entryDate || entry?.entryDate || new Date());
      cds.log('gatepass-update').warn(`Replacing invalid persisted GateEntryNumber during update for ID=${ID}: ${entry.gateEntryNumber} -> ${data.gateEntryNumber}`);
    }

    const sMovementType = (data.movementType || '').toString().trim() || '';
    const sReferenceType = (data.referenceType || '').toString().trim() || '';
    const sReferenceNumber = (data.referenceNumber || '').toString().trim();
    if (sMovementType === 'O' && !sReferenceNumber) {
      return req.error(400, 'Reference Number (Invoice) is mandatory for Outward movement');
    }
    if ((sMovementType === 'O' || sReferenceType === 'SI') && sReferenceNumber) {
      data.referenceType = 'SI';
      try {
        const oInvoiceSnapshot = await this._fetchSalesInvoiceDetails(sReferenceNumber, req, {
          gateEntryID: ID || null,
          preferLocal: false,
          persistSnapshot: false
        });
        if (oInvoiceSnapshot) {
          this._applySalesInvoiceSnapshotToGateEntryData(data, oInvoiceSnapshot);
        }
      } catch (e) {
        if (this._isRemoteAuthorizationError(e)) {
          return req.reject(403, this._buildS4BusinessValidationErrorMessage());
        }
        if (this._isRemoteBusinessValidationError(e)) {
          return req.reject(400, this._buildS4BusinessValidationErrorMessage());
        }
        throw e;
      }
    }
  }

  /**
   * Action: Save GatePass form data against selected Gate Entry (no GatePass record creation)
   */
  async _onSaveGatePassData(req) {
    const data = req.data || {};
    const oLog = cds.log('gatepass-save');

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
    if (!data.invoiceDate) {
      return req.error(400, 'Invoice Date is mandatory');
    }

    // Validate Gate Entry exists and is open
    const entry = await this._findGateEntryByID(data.gateEntryID);
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
    const sReferenceType = data.referenceType !== undefined
      ? ((data.referenceType || '').toString().trim() || null)
      : (entry.referenceType || null);
    const sReferenceNumber = data.referenceNumber !== undefined
      ? ((data.referenceNumber || '').toString().trim() || null)
      : (entry.referenceNumber || null);
    const sMovementType = data.movementType !== undefined
      ? ((data.movementType || '').toString().trim() || null)
      : (entry.movementType || null);
    let sPlant = data.plant !== undefined
      ? ((data.plant || '').toString().trim() || null)
      : (entry.plant || null);
    let sPartyNumber = data.partyNumber !== undefined
      ? ((data.partyNumber || '').toString().trim() || null)
      : (entry.partyNumber || null);
    let sPartyName = data.partyName !== undefined
      ? ((data.partyName || '').toString().trim() || null)
      : (entry.partyName || null);
    const sInvoiceValue = data.invoiceValue !== undefined
      ? ((data.invoiceValue || '').toString().trim() || null)
      : (entry.invoiceValue || null);
    if (sReferenceType === 'PO' && sReferenceNumber && (!sPlant || !sPartyNumber || !sPartyName)) {
      try {
        const oPODetails = await this._fetchPODetails(sReferenceNumber, req);
        if (oPODetails) {
          sPlant = sPlant || oPODetails.plant || null;
          sPartyNumber = sPartyNumber || oPODetails.supplierNumber || null;
          sPartyName = sPartyName || oPODetails.supplierName || null;
        }
      } catch (e) {
        if (this._isRemoteAuthorizationError(e)) {
          return req.reject(403, this._buildPOAuthorizationErrorMessage(e));
        }
      }
    }
    let oSalesInvoiceSnapshot = null;
    if ((sMovementType === 'O' || sReferenceType === 'SI') && sReferenceNumber) {
      try {
        oSalesInvoiceSnapshot = await this._fetchSalesInvoiceDetails(sReferenceNumber, req, {
          gateEntryID: entry.ID,
          preferLocal: false,
          persistSnapshot: false
        });
        if (oSalesInvoiceSnapshot) {
          sPlant = sPlant || oSalesInvoiceSnapshot.plant || null;
          sPartyNumber = sPartyNumber || oSalesInvoiceSnapshot.customerNumber || null;
          sPartyName = sPartyName || oSalesInvoiceSnapshot.customerName || null;
        }
      } catch (e) {
        if (this._isRemoteAuthorizationError(e)) {
          return req.reject(403, this._buildS4BusinessValidationErrorMessage());
        }
        if (this._isRemoteBusinessValidationError(e)) {
          return req.reject(400, this._buildS4BusinessValidationErrorMessage());
        }
        throw e;
      }
    }

    // Validate and normalize items JSON payload.
    let sItemsJson = entry.materialItemsJson || null;
    if (data.itemsJson) {
      try {
        const parsed = typeof data.itemsJson === 'string' ? JSON.parse(data.itemsJson) : data.itemsJson;
        const aItems = Array.isArray(parsed) ? parsed : [];
        const aValidatedItems = aItems.map((oItem, iIndex) => {
          const oRow = oItem || {};
          const nChallanQty = Number(oRow.challanQuantity);
          const nBilledQty = Number(oRow.quantity);
          const sBatch = (oRow.batch || '').toString().trim();
          const sStorageLocation = (oRow.storageLocation || '').toString().trim();
          const sPlant = (oRow.plant || '').toString().trim();
          const sDateOfManufacture = this._normalizeDate(oRow.dateOfManufacture);
          if (sMovementType !== 'O' && (!Number.isFinite(nChallanQty) || nChallanQty <= 0)) {
            throw new Error(`CHALLAN_QTY_INVALID:${iIndex + 1}`);
          }
          if (sMovementType === 'O' && (!Number.isFinite(nBilledQty) || nBilledQty < 0)) {
            throw new Error(`BILLED_QTY_INVALID:${iIndex + 1}`);
          }
          if (sDateOfManufacture && !this._isNormalizedDate(sDateOfManufacture)) {
            throw new Error(`DATE_OF_MANUFACTURE_INVALID:${iIndex + 1}`);
          }
          return {
            ...oRow,
            challanQuantity: sMovementType === 'O' ? null : nChallanQty,
            storageLocation: sStorageLocation || null,
            plant: sPlant || null,
            batch: sBatch || null,
            quantity: Number.isFinite(nBilledQty) ? nBilledQty : oRow.quantity,
            dateOfManufacture: sDateOfManufacture && this._isNormalizedDate(sDateOfManufacture)
              ? sDateOfManufacture
              : null
          };
        });
      sItemsJson = JSON.stringify(this._compactMaterialItemsForCBO(aValidatedItems, sMovementType === 'O'));
      } catch (e) {
        if (e && typeof e.message === 'string' && e.message.startsWith('CHALLAN_QTY_INVALID:')) {
          const sIndex = e.message.split(':')[1] || '?';
          return req.error(400, `Challan Quantity must be greater than zero for item ${sIndex}`);
        }
        if (e && typeof e.message === 'string' && e.message.startsWith('DATE_OF_MANUFACTURE_INVALID:')) {
          const sIndex = e.message.split(':')[1] || '?';
          return req.error(400, `Date of Manufacture is invalid for item ${sIndex}`);
        }
        if (e && typeof e.message === 'string' && e.message.startsWith('BILLED_QTY_INVALID:')) {
          const sIndex = e.message.split(':')[1] || '?';
          return req.error(400, `Billed Quantity is invalid for item ${sIndex}`);
        }
        return req.error(400, 'Material items payload is invalid');
      }
    } else if (!sItemsJson && oSalesInvoiceSnapshot && Array.isArray(oSalesInvoiceSnapshot.items) && oSalesInvoiceSnapshot.items.length) {
      sItemsJson = JSON.stringify(this._compactMaterialItemsForCBO(oSalesInvoiceSnapshot.items.map((oItem, iIndex) => ({
        itemNumber: iIndex + 1,
        deliveryNumber: (oItem.deliveryNumber || oSalesInvoiceSnapshot.deliveryNumber || '').toString(),
        materialCode: oItem.materialCode || '',
        materialDescription: oItem.materialDescription || '',
        quantity: Number(oItem.quantity || 0),
        challanQuantity: null,
        unitOfMeasure: oItem.unitOfMeasure || '',
        orderItemNumber: oItem.orderItemNumber || '',
        plant: oItem.plant || null,
        storageLocation: oItem.storageLocation || null,
        batch: '',
        dateOfManufacture: null
      })), sMovementType === 'O'));
    }

    // Outward entries always become CREATED after Gate Pass save.
    // Inward keeps existing PO/without-PO behavior.
    const bHasPOReference = sReferenceType === 'PO' && !!sReferenceNumber;
    const sNewEntryStatus = sMovementType === 'O'
      ? 'CREATED'
      : (bHasPOReference ? 'CREATED' : 'PARKED');
    let sSafeGateEntryNumber = (entry.gateEntryNumber || '').toString().trim();
    if (this._isValidGateEntryNumberForCBO(sSafeGateEntryNumber)) {
      sSafeGateEntryNumber = sSafeGateEntryNumber.toUpperCase();
    } else {
      const sInvalidGateEntryNumber = sSafeGateEntryNumber;
      sSafeGateEntryNumber = await this._getNextGateEntryNumber(sPassDate || entry.entryDate || new Date());
      cds.log('gatepass-save').warn(`Replacing invalid GateEntryNumber during saveGatePassData for ID=${entry.ID}: ${sInvalidGateEntryNumber} -> ${sSafeGateEntryNumber}`);
    }

    try {
      await this._updateCBOEntity('GateEntries', entry.ID, this._mapGateEntryToCBO({
        ID: entry.ID,
        gateEntryNumber: sSafeGateEntryNumber,
        referenceType: sReferenceType,
        referenceNumber: sReferenceNumber,
        plant: sPlant,
        partyNumber: sPartyNumber,
        partyName: sPartyName,
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
        entryStatus: sNewEntryStatus
      }, true));
    } catch (e) {
      this._logRemoteErrorDetails(oLog, `saveGatePassData GateEntries update failed for ID=${entry.ID}`, e);
      if (this._isRemoteAuthorizationError(e)) {
        return req.reject(403, 'S/4 authorization error while saving Gate Pass data.');
      }
      if (this._isRemoteBusinessValidationError(e)) {
        return req.reject(400, this._getRemoteErrorMessage(e) || this._buildS4BusinessValidationErrorMessage());
      }
      throw e;
    }

    let aSavedItems = [];
    if (sItemsJson) {
      aSavedItems = this._parseMaterialItemsJson(sItemsJson);
    }
    try {
      await this._replaceGatePassItemsForGatePass(entry.ID, aSavedItems);
    } catch (e) {
      this._logRemoteErrorDetails(oLog, `saveGatePassData GatePassItems replace failed for gatePassID=${entry.ID}`, e);
      if (this._isRemoteAuthorizationError(e)) {
        return req.reject(403, 'S/4 authorization error while saving Gate Pass items.');
      }
      if (this._isRemoteBusinessValidationError(e)) {
        return req.reject(400, this._getRemoteErrorMessage(e) || this._buildS4BusinessValidationErrorMessage());
      }
      throw e;
    }

    return this._findGateEntryByID(entry.ID);
  }

  /**
   * Before UPDATE Gate Pass
   */
  async _onBeforeUpdateGatePass(req) {
    const { ID } = req.data;
    const pass = this._mapGatePassFromCBO(await this._getCBOEntityByID('GatePasses', ID));
    if (pass && pass.documentStatus === 'CLOSED') {
      return req.error(400, 'Cannot modify a closed Gate Pass');
    }
  }

  /**
   * Action: Close Gate Entry (Gate Exit)
   */
  async _onCloseGateEntry(req) {
    const {
      gateEntryID,
      gatePassID,
      exitDate,
      exitTime,
      clientTimezoneOffsetMinutes,
      securityOfficer,
      remarks
    } = req.data || {};

    // Validate Gate Entry
    const entry = await this._findGateEntryByID(gateEntryID);
    if (!entry) {
      return req.error(404, 'Gate Entry not found');
    }
    if (entry.entryStatus === 'EXITED') {
      return req.error(400, 'Gate Entry is already exited');
    }
    if (entry.entryStatus === 'CANCELLED') {
      return req.error(400, 'Gate Entry is cancelled');
    }
    if (entry.entryStatus !== 'CREATED' && entry.entryStatus !== 'PASS_ISSUED' && entry.entryStatus !== 'PARKED') {
      return req.error(400, 'Gate Entry is not open for exit');
    }

    // Validate optional Gate Pass if provided
    let pass = null;
    if (gatePassID) {
      pass = await this._findGatePassByID(gatePassID);
      if (!pass) {
        return req.error(404, 'Gate Pass not found');
      }
      if (pass.gateEntry_ID && pass.gateEntry_ID !== gateEntryID) {
        return req.error(400, 'Gate Pass does not belong to this Gate Entry');
      }
    } else {
      const sFilter = `gateEntry_ID eq '${this._escapeODataV2String(gateEntryID)}'`;
      const aPassRows = await this._listCBOEntities('GatePasses', { _queryOptions: { $filter: sFilter, $top: 1 } }, 1);
      pass = this._mapGatePassFromCBO((aPassRows || [])[0] || null);
      if (!pass) {
        pass = this._buildVirtualGatePassFromEntry(entry);
      }
    }

    // Generate Gate Exit Number
    const aExitRows = await this._listCBOEntities('GateExit', { _queryOptions: { $top: 5000 } }, 5000);
    const seq = (aExitRows || []).length + 1;
    const gateExitNumber = `GX-${String(seq).padStart(6, '0')}`;

    const sExitDate = this._normalizeDate(exitDate || new Date());
    const sExitTime = this._normalizeTime(exitTime || this._getCurrentTimeHHMMSS());
    if (!this._isNormalizedDate(sExitDate)) {
      return req.error(400, 'Exit Date is invalid');
    }
    if (!this._isNormalizedTime(sExitTime)) {
      return req.error(400, 'Exit Time is invalid');
    }
    const nClientTimezoneOffsetMinutes = Number.parseInt(clientTimezoneOffsetMinutes, 10);
    const oExitDateTime = this._toDateTimeWithClientOffset(
      sExitDate,
      sExitTime,
      Number.isInteger(nClientTimezoneOffsetMinutes) ? nClientTimezoneOffsetMinutes : null
    );
    if (!oExitDateTime) {
      return req.error(400, 'Exit Date/Time is invalid');
    }
    if (oExitDateTime.getTime() > Date.now() + this._getExitFutureToleranceMs()) {
      return req.error(400, 'Exit Date/Time cannot be in the future');
    }

    const sSecurityOfficer = (securityOfficer || req.user?.id || 'SYSTEM').toString().trim() || 'SYSTEM';
    const sRemarks = (remarks || '').toString().trim();
    let sSafeGateEntryNumber = (entry.gateEntryNumber || '').toString().trim();
    if (this._isValidGateEntryNumberForCBO(sSafeGateEntryNumber)) {
      sSafeGateEntryNumber = sSafeGateEntryNumber.toUpperCase();
    } else {
      const sInvalidGateEntryNumber = sSafeGateEntryNumber;
      sSafeGateEntryNumber = await this._getNextGateEntryNumber(entry.entryDate || sExitDate || new Date());
      cds.log('gatepass-close').warn(`Replacing invalid GateEntryNumber during closeGateEntry for ID=${gateEntryID}: ${sInvalidGateEntryNumber} -> ${sSafeGateEntryNumber}`);
    }

    const oLog = cds.log('gatepass-close');
    // Create Gate Exit record
    const oExitPayload = {
      gateExitNumber,
      gateEntry_ID: gateEntryID,
      gateEntryNumber: sSafeGateEntryNumber,
      exitDate: sExitDate,
      exitTime: sExitTime,
      securityOfficer: sSecurityOfficer
    };
    if (sRemarks) {
      oExitPayload.remarks = sRemarks;
    }
    if (pass && pass.ID) {
      oExitPayload.gatePassNumber = pass.gatePassNumber;
    }
    const sGatePassNumber = (oExitPayload.gatePassNumber || '').toString().trim();
    try {
      await this._createCBOEntity('GateExit', {
        ID: randomUUID(),
        gateExitNumber: oExitPayload.gateExitNumber,
        gateEntry_ID: oExitPayload.gateEntry_ID,
        gateEntryNumber: oExitPayload.gateEntryNumber,
        gatePassNumber: sGatePassNumber ? sGatePassNumber.slice(0, 20) : undefined,
        exitDate: this._toODataV2Date(oExitPayload.exitDate),
        exitTime: this._toODataV2Duration(oExitPayload.exitTime),
        securityOfficer: oExitPayload.securityOfficer,
        remarks: oExitPayload.remarks || undefined
      });
    } catch (e) {
      this._logRemoteErrorDetails(oLog, `closeGateEntry GateExit create failed for gateEntryID=${gateEntryID}`, e);
      if (this._isRemoteAuthorizationError(e)) {
        return req.reject(403, 'S/4 authorization error while closing Gate Entry.');
      }
      if (this._isRemoteBusinessValidationError(e)) {
        return req.reject(400, this._getRemoteErrorMessage(e) || this._buildS4BusinessValidationErrorMessage());
      }
      throw e;
    }

    // CR004: PARKED entries keep PARKED after exit (until GR or manual closure).
    // Also treat legacy inward blank-PO entries as PARKED to avoid disappearing from GatePass flow.
    const sEntryReferenceType = (entry.referenceType || '').toString().trim().toUpperCase();
    const sEntryReferenceNumber = (entry.referenceNumber || '').toString().trim();
    const bLegacyWithoutPO = sEntryReferenceType === 'PO' && !sEntryReferenceNumber;
    const bIsOutward = (entry.movementType || '').toString().trim().toUpperCase() === 'O';
    const bKeepParkedAfterExit = !bIsOutward && (entry.entryStatus === 'PARKED' || bLegacyWithoutPO);
    const sNextEntryStatus = bKeepParkedAfterExit ? 'PARKED' : 'EXITED';
    if (bKeepParkedAfterExit) {
      await this._updateCBOEntity('GateEntries', gateEntryID, this._mapGateEntryToCBO({
        ...entry,
        gateEntryNumber: sSafeGateEntryNumber,
        entryStatus: 'PARKED',
        documentStatus: 'CLOSED'
      }, true));
    } else {
      await this._updateCBOEntity('GateEntries', gateEntryID, this._mapGateEntryToCBO({
        ...entry,
        gateEntryNumber: sSafeGateEntryNumber,
        entryStatus: 'EXITED',
        documentStatus: 'CLOSED'
      }, true));
    }

    // Return updated Gate Entry
    return {
      ...entry,
      gateEntryNumber: sSafeGateEntryNumber,
      entryStatus: sNextEntryStatus,
      documentStatus: 'CLOSED'
    };
  }

  /**
   * Action: Print Gate Pass
   */
  async _onPrintGatePass(req) {
    const { gatePassID } = req.data;
    const pass = await this._findGatePassByID(gatePassID);
    if (!pass) {
      return req.error(404, 'Gate Pass not found');
    }
    let items = Array.isArray(pass.items) ? pass.items : [];
    if (!items.length) {
      const sFilter = `gatePass_ID eq '${this._escapeODataV2String(gatePassID)}'`;
      const aRows = await this._listCBOEntities('GatePassItems', { _queryOptions: { $filter: sFilter, $top: 5000 } }, 5000);
      items = aRows.map((oRow) => this._mapGatePassItemFromCBO(oRow)).filter(Boolean);
    }

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
        deliveryNumber: item.deliveryNumber || '',
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
    const oLog = cds.log('gatepass-po');
    try {
      return await this._fetchPODetails(poNumber, req);
    } catch (e) {
      this._logRemoteErrorDetails(oLog, `PO details lookup failed for ${poNumber || ''}`, e);
      if (this._isRemoteAuthorizationError(e)) {
        return req.reject(403, this._buildPOAuthorizationErrorMessage(e));
      }
      if (this._isRemoteBusinessValidationError(e)) {
        return req.reject(400, this._buildS4BusinessValidationErrorMessage());
      }
      throw e;
    }
  }

  /**
   * Function: Get Purchase Order Snapshot with quantity mapped to yearly cumulative received quantity
   */
  async _onGetPurchaseOrderReceivedSnapshot(req) {
    const { poNumber } = req.data;
    const oLog = cds.log('gatepass-po');
    try {
      const aRows = await this._fetchPORows(poNumber, req);
      const aReceivedRows = await this._applyCurrentYearReceivedQuantities(poNumber, aRows, req);
      const oFirst = aReceivedRows[0] || {};
      return {
        plant: oFirst.plant || '',
        supplierNumber: oFirst.vendor || '',
        supplierName: oFirst.vendor_name || '',
        itemsJson: JSON.stringify(aReceivedRows || [])
      };
    } catch (e) {
      this._logRemoteErrorDetails(oLog, `PO received snapshot lookup failed for ${poNumber || ''}`, e);
      if (this._isRemoteAuthorizationError(e)) {
        return req.reject(403, this._buildPOAuthorizationErrorMessage(e));
      }
      if (this._isRemoteBusinessValidationError(e)) {
        return req.reject(400, this._buildS4BusinessValidationErrorMessage());
      }
      throw e;
    }
  }

  /**
   * Function: Get Purchase Order Snapshot (header + item rows JSON)
   */
  async _onGetPurchaseOrderSnapshot(req) {
    const { poNumber } = req.data;
    const oLog = cds.log('gatepass-po');
    try {
      const aRows = await this._fetchPORows(poNumber, req);
      const aResidualRows = await this._applyCurrentYearResidualQuantities(poNumber, aRows, req);
      const oFirst = aResidualRows[0] || {};
      return {
        plant: oFirst.plant || '',
        supplierNumber: oFirst.vendor || '',
        supplierName: oFirst.vendor_name || '',
        itemsJson: JSON.stringify(aResidualRows || [])
      };
    } catch (e) {
      this._logRemoteErrorDetails(oLog, `PO snapshot lookup failed for ${poNumber || ''}`, e);
      if (this._isRemoteAuthorizationError(e)) {
        return req.reject(403, this._buildPOAuthorizationErrorMessage(e));
      }
      if (this._isRemoteBusinessValidationError(e)) {
        return req.reject(400, this._buildS4BusinessValidationErrorMessage());
      }
      throw e;
    }
  }

  /**
   * Function: Get open Goods Receipt items for a Purchase Order
   */
  async _onGetGoodsReceiptOpenItems(req) {
    const { poNumber } = req.data || {};
    const oLog = cds.log('gatepass-gr');
    try {
      const aRows = await this._fetchGoodsReceiptOpenItems(poNumber, req);
      return {
        itemsJson: JSON.stringify(aRows)
      };
    } catch (e) {
      this._logRemoteErrorDetails(oLog, `GR open-items lookup failed for ${poNumber || ''}`, e);
      if (this._isRemoteAuthorizationError(e)) {
        return req.reject(403, this._buildGRAuthorizationErrorMessage(e));
      }
      if (this._isRemoteBusinessValidationError(e)) {
        return req.reject(400, this._buildS4BusinessValidationErrorMessage());
      }
      throw e;
    }
  }

  /**
   * Action: Post Goods Receipt for selected Gate Pass items
   */
  async _onPostGoodsReceipt(req) {
    const oLog = cds.log('gatepass-gr');
    const { gateEntryID, itemsJson, poNumber } = req.data || {};
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

    const oEntry = await this._findGateEntryByID(gateEntryID);
    if (!oEntry) {
      return req.error(404, 'Gate Entry not found');
    }
    if (oEntry.referenceType !== 'PO') {
      return req.error(400, 'Goods Receipt is supported only for Purchase Order references');
    }
    const sPONumber = (oEntry.referenceNumber || poNumber || '').toString().trim();
    if (!sPONumber) {
      return req.error(400, 'Reference Purchase Order number is missing');
    }
    const sInvoiceValue = (oEntry.referenceNumber || '').toString().trim();
    const sPassRemarks = (oEntry.passRemarks || '').toString().trim();
    let sPOHeaderText = '';
    try {
      sPOHeaderText = await this._fetchPOHeaderText(sPONumber, req);
    } catch (e) {
      this._logRemoteErrorDetails(oLog, `Failed to derive PO header text for PO ${sPONumber}`, e);
      if (this._isRemoteAuthorizationError(e)) {
        return req.reject(403, this._buildPOAuthorizationErrorMessage(e));
      }
      if (this._isRemoteBusinessValidationError(e)) {
        return req.reject(400, this._buildS4BusinessValidationErrorMessage());
      }
      throw e;
    }
    let aSavedItems = [];
    if (oEntry.materialItemsJson) {
      aSavedItems = this._parseMaterialItemsJson(oEntry.materialItemsJson);
    }
    const mSavedItemsByOrderItem = {};
    aSavedItems.forEach((oSavedItem) => {
      const sSavedOrderItem = this._normalizePOItemNumber(oSavedItem?.orderItemNumber);
      if (sSavedOrderItem) {
        mSavedItemsByOrderItem[sSavedOrderItem] = oSavedItem || {};
      }
    });

    let aOpenRows = [];
    try {
      aOpenRows = await this._fetchGoodsReceiptOpenItems(sPONumber, req);
    } catch (e) {
      this._logRemoteErrorDetails(oLog, `Failed to derive GR open items for PO ${sPONumber}`, e);
      if (this._isRemoteAuthorizationError(e)) {
        return req.reject(403, this._buildGRAuthorizationErrorMessage(e));
      }
      if (this._isRemoteBusinessValidationError(e)) {
        return req.reject(400, this._buildS4BusinessValidationErrorMessage());
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

    const oPostingDate = new Date();
    const sPostingDate = this._toODataV2DateTime(oPostingDate);
    const sDefaultStorageLocation = this._getDefaultGRStorageLocation();
    // Gate Entry No goes into each material-document item as YY1_GatePassNo_MMI
    const sGateEntryNumber = (oEntry.gateEntryNumber || '').toString().trim();
    const aMaterialDocItems = [];
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
      const sEntryUnit = (oOpenItem.purchaseOrderQuantityUnit || '').toString().trim();
      if (!sEntryUnit) {
        return req.error(400, `Order item ${sItemNo} is missing PO unit required for Goods Receipt posting`);
      }
      const oSavedItem = mSavedItemsByOrderItem[sItemNo] || {};
      const sPreferredStorageLocation = (
        oItem?.storageLocation ||
        oSavedItem.storageLocation ||
        ''
      ).toString().trim();

      let sStorageLocation = '';
      try {
        const oStorageSource = sPreferredStorageLocation
          ? { ...oOpenItem, storageLocation: sPreferredStorageLocation }
          : oOpenItem;
        sStorageLocation = await this._resolveGRStorageLocation(oStorageSource, sDefaultStorageLocation, req);
      } catch (e) {
        this._logRemoteErrorDetails(oLog, `Failed to resolve Storage Location for PO ${sPONumber} item ${sItemNo}`, e);
        if (this._isRemoteAuthorizationError(e)) {
          return req.reject(403, this._buildGRAuthorizationErrorMessage(e));
        }
        if (this._isRemoteBusinessValidationError(e)) {
          return req.reject(400, this._buildS4BusinessValidationErrorMessage());
        }
        throw e;
      }
      if (!sStorageLocation) {
        return req.error(400, `Storage Location is required for order item ${sItemNo}. Set S4_GR_STORAGE_LOCATION if not available on PO item.`);
      }
      const sPlant = (oOpenItem.plant || '').toString().trim();
      if (!sPlant) {
        return req.error(400, `Plant is required for order item ${sItemNo} for Goods Movement posting`);
      }

      const oMaterialDocItem = {
        // Unique Line-ID per item — mandatory when item-level YY1 custom fields are used (SAP KBA 3488329 / MM_IM_ODATA_API_MDOC/027)
        MaterialDocumentLine: String(aMaterialDocItems.length + 1).padStart(4, '0'),
        GoodsMovementType: '101',
        GoodsMovementRefDocType: 'B',
        PurchaseOrder: (oOpenItem.purchaseOrder || sPONumber).toString(),
        PurchaseOrderItem: this._formatPOItemForMaterialDoc(oOpenItem.purchaseOrderItem || sItemNo),
        QuantityInEntryUnit: nQty.toFixed(3),
        EntryUnit: sEntryUnit,
        Plant: sPlant,
        StorageLocation: sStorageLocation
      };
      if (sGateEntryNumber) {
        oMaterialDocItem.YY1_GatePassNo_MMI = sGateEntryNumber;
      }
      const sMaterial = (oOpenItem.material || '').toString().trim();
      if (sMaterial) {
        oMaterialDocItem.Material = sMaterial;
      }
      const sGoodsRecipient = (oItem?.goodsRecipient || oSavedItem.goodsRecipient || '').toString().trim();
      if (sGoodsRecipient) {
        oMaterialDocItem.GoodsRecipientName = sGoodsRecipient;
      }
      // GdsMvtExtAmtInCoCodeCrcy intentionally not sent: not supported for GoodsMovementType 101
      // (MM_IM_ODATA_API_MDOC/011). Local currency amount stays display-only in the GatePass app.
      const sBatch = (oItem?.batch || oSavedItem.batch || '').toString().trim();
      const sDateOfManufactureInput = oItem?.dateOfManufacture || oSavedItem.dateOfManufacture;
      const sDateOfManufacture = this._normalizeDate(sDateOfManufactureInput);
      if (sDateOfManufacture && !this._isNormalizedDate(sDateOfManufacture)) {
        return req.error(400, `Date of Manufacture is invalid for order item ${sItemNo}`);
      }
      if (sBatch) {
        oMaterialDocItem.Batch = sBatch;
      }
      if (sDateOfManufacture && this._isNormalizedDate(sDateOfManufacture)) {
        oMaterialDocItem.ManufactureDate = this._toODataV2DateTime(sDateOfManufacture);
      }
      aMaterialDocItems.push(oMaterialDocItem);
    }

    const oPayload = {
      DocumentDate: sPostingDate,
      PostingDate: sPostingDate,
      GoodsMovementCode: '01',
      MaterialDocumentHeaderText: this._truncateMaterialDocumentHeaderText(sPOHeaderText || sPassRemarks || ''),
      to_MaterialDocumentItem: {
        results: aMaterialDocItems
      }
    };
    if (sInvoiceValue) {
      oPayload.ReferenceDocument = sInvoiceValue;
    }

    oLog.info(`Posting Goods Receipt for PO ${sPONumber} with ${aMaterialDocItems.length} item(s) via API_MATERIAL_DOCUMENT_SRV`);
    try {
      const oResultRaw = await this._callPostGoodsReceipt(oPayload, req);
      const oResult = this._unwrapODataPayload(oResultRaw);
      const oFirstItemResult = this._normalizeCollection(oResult?.to_MaterialDocumentItem)[0] || {};
      const sMatDoc = (
        this._pickFirstValue(oResult, ['MaterialDocument', 'MATERIALDOCUMENT']) ||
        this._pickFirstValue(oFirstItemResult, ['MaterialDocument', 'MATERIALDOCUMENT']) ||
        ''
      ).toString();
      const sMatYear = (
        this._pickFirstValue(oResult, ['MaterialDocumentYear', 'MATERIALDOCUMENTYEAR']) ||
        this._pickFirstValue(oFirstItemResult, ['MaterialDocumentYear', 'MATERIALDOCUMENTYEAR']) ||
        ''
      ).toString();
      oLog.info(`Goods Receipt posted for PO ${sPONumber}: ${sMatDoc}/${sMatYear}`);

      // CR004: After GR, transition entry to EXITED if it was previously exited (CLOSED) but held back as PARKED/CREATED waiting for PO/GR
      if (oEntry.entryStatus === 'PARKED' || oEntry.documentStatus === 'CLOSED') {
        await this._updateCBOEntity('GateEntries', gateEntryID, this._mapGateEntryToCBO({
          ...oEntry,
          entryStatus: 'EXITED'
        }, true));
      }

      return {
        success: true,
        materialDocument: sMatDoc,
        materialDocumentYear: sMatYear,
        postedItems: aMaterialDocItems.length,
        message: `Goods Receipt posted for ${aMaterialDocItems.length} item(s)`
      };
    } catch (e) {
      this._logRemoteErrorDetails(oLog, `Goods Receipt posting failed for PO ${sPONumber}`, e);
      if (this._isRemoteAuthorizationError(e)) {
        return req.reject(403, this._buildGRAuthorizationErrorMessage(e));
      }
      if (this._isRemoteBusinessValidationError(e)) {
        return req.reject(400, this._buildS4BusinessValidationErrorMessage());
      }
      throw e;
    }
  }

  /**
   * Function: Get Sales Invoice Details
   */
  async _onGetSalesInvoiceDetails(req) {
    const { invoiceNumber } = req.data;
    const oLog = cds.log('gatepass-si');
    try {
      return await this._fetchSalesInvoiceDetails(invoiceNumber, req, {
        preferLocal: false,
        persistSnapshot: false
      });
    } catch (e) {
      this._logRemoteErrorDetails(oLog, `Sales Invoice lookup failed for ${invoiceNumber || ''}`, e);
      if (this._isRemoteAuthorizationError(e)) {
        return req.reject(403, this._buildSIAuthorizationErrorMessage(e));
      }
      if (this._isRemoteBusinessValidationError(e)) {
        return req.reject(400, this._buildS4BusinessValidationErrorMessage());
      }
      throw e;
    }
  }

  /**
   * Function: Gate Pass operational report (read-only; joins Gate Entry + items + Gate Exit + GRN)
   */
  async _onGetGatePassReport(req) {
    const oLog = cds.log('gatepass-report');
    const aEntryRows = await this._getAllGateEntriesRaw();
    const aEntries = (aEntryRows || [])
      .map((oRow) => {
        const oMapped = this._mapGateEntryFromCBO(oRow);
        if (oMapped) {
          // Supplier invoice no persisted on the CBO invoiceNo field (inward); outward uses referenceNumber
          oMapped.invoiceNumberRaw = (oRow?.invoiceNo || oRow?.InvoiceNo || '').toString().trim();
        }
        return oMapped;
      })
      .filter(Boolean)
      .sort((a, b) => (b.entryDate || '').localeCompare(a.entryDate || ''))
      .slice(0, 2000);

    const mExitByEntryID = {};
    const aExitRows = await this._listCBOEntities('GateExit', { _queryOptions: { $top: 5000 } }, 5000);
    (aExitRows || []).forEach((oRow) => {
      const oExit = this._mapGateExitFromCBO(oRow);
      if (!oExit || !oExit.gateEntry_ID) {
        return;
      }
      const oExisting = mExitByEntryID[oExit.gateEntry_ID];
      if (!oExisting || (oExit.exitDate || '') >= (oExisting.exitDate || '')) {
        mExitByEntryID[oExit.gateEntry_ID] = oExit;
      }
    });

    // GR postings per distinct inward PO reference (warn-and-continue per PO)
    const aPONumbers = [...new Set(aEntries
      .filter((oEntry) => (oEntry.movementType || '').toString().trim().toUpperCase() !== 'O')
      .map((oEntry) => (oEntry.referenceNumber || '').toString().trim())
      .filter(Boolean))];
    // Two maps: exact entry match via YY1_GatePassNo_MMI (posted by this app),
    // plus PO+item fallback for GRs posted before the field existed.
    const mGRByPOItem = {};
    const mGRByGEItem = {};
    for (const sPONumber of aPONumbers) {
      try {
        const aGRRows = await this._fetchGRRowsByPO(sPONumber, req);
        aGRRows.forEach((oGR) => {
          if (!oGR.purchaseOrderItem) {
            return;
          }
          if (oGR.gateEntryNumber) {
            const sGEKey = `${oGR.gateEntryNumber}::${oGR.purchaseOrderItem}`;
            (mGRByGEItem[sGEKey] = mGRByGEItem[sGEKey] || []).push(oGR);
          } else {
            const sKey = `${sPONumber}::${oGR.purchaseOrderItem}`;
            (mGRByPOItem[sKey] = mGRByPOItem[sKey] || []).push(oGR);
          }
        });
      } catch (e) {
        oLog.warn(`GR lookup failed for PO ${sPONumber}. Report rows will show blank GRN fields. ${e.message}`);
      }
    }
    const mGRMaps = { byPOItem: mGRByPOItem, byGEItem: mGRByGEItem };

    const aRows = [];
    aEntries.forEach((oEntry) => {
      aRows.push(...this._buildGatePassReportRows(oEntry, mExitByEntryID[oEntry.ID] || null, mGRMaps));
    });
    return { rowsJson: JSON.stringify(aRows) };
  }

  // GR postings for a PO with GRN document numbers (report only; does not change the GR tracker fetch)
  // Note: A_MaterialDocumentItem has no PostingDate property in this system version —
  // posting dates are joined from A_MaterialDocumentHeader per distinct material document.
  async _fetchGRRowsByPO(poNumber, req) {
    const sPONumber = (poNumber || '').toString().trim();
    if (!sPONumber) {
      return [];
    }
    const sPath = this._buildS4Path(
      this._getGRServiceRoot(),
      `/A_MaterialDocumentItem?$filter=PurchaseOrder eq '${this._escapeODataString(sPONumber)}'&$select=PurchaseOrder,PurchaseOrderItem,MaterialDocument,MaterialDocumentYear,QuantityInEntryUnit,StorageLocation,GoodsMovementType,DebitCreditCode,YY1_GatePassNo_MMI&$top=5000&$format=json`
    );
    const oGRService = await this._getGRService();
    const oRemoteClient = req ? oGRService.tx(req) : oGRService;
    const oResponse = await oRemoteClient.send({
      method: 'GET',
      path: sPath
    });
    const aRows = this._extractODataV2Results(oResponse)
      .map((oRow) => {
        const nQty = this._resolveSignedMaterialDocumentQuantity(oRow);
        if (!nQty) {
          return null;
        }
        return {
          purchaseOrderItem: this._normalizePOItemNumber(this._pickFirstValue(oRow, ['PurchaseOrderItem', 'purchaseOrderItem']) || ''),
          gateEntryNumber: (this._pickFirstValue(oRow, ['YY1_GatePassNo_MMI', 'yy1GatePassNoMmi']) || '').toString().trim(),
          grnNumber: (this._pickFirstValue(oRow, ['MaterialDocument', 'materialDocument']) || '').toString(),
          grnYear: (this._pickFirstValue(oRow, ['MaterialDocumentYear', 'materialDocumentYear']) || '').toString(),
          grnPostingDate: null,
          grnStorageLocation: (this._pickFirstValue(oRow, ['StorageLocation', 'storageLocation']) || '').toString(),
          grnQuantity: nQty
        };
      })
      .filter(Boolean);

    const aDocKeys = [...new Set(aRows.map((oRow) => `${oRow.grnNumber}::${oRow.grnYear}`))]
      .filter((sKey) => !sKey.startsWith('::'));
    if (aDocKeys.length) {
      try {
        const sHeaderFilter = aDocKeys.map((sKey) => {
          const [sDoc, sYear] = sKey.split('::');
          return `(MaterialDocument eq '${this._escapeODataString(sDoc)}' and MaterialDocumentYear eq '${this._escapeODataString(sYear)}')`;
        }).join(' or ');
        const sHeaderPath = this._buildS4Path(
          this._getGRServiceRoot(),
          `/A_MaterialDocumentHeader?$filter=${sHeaderFilter}&$select=MaterialDocument,MaterialDocumentYear,PostingDate&$top=5000&$format=json`
        );
        const oHeaderResponse = await oRemoteClient.send({
          method: 'GET',
          path: sHeaderPath
        });
        const mPostingByDoc = {};
        this._extractODataV2Results(oHeaderResponse).forEach((oHeader) => {
          const sDoc = (this._pickFirstValue(oHeader, ['MaterialDocument', 'materialDocument']) || '').toString();
          const sYear = (this._pickFirstValue(oHeader, ['MaterialDocumentYear', 'materialDocumentYear']) || '').toString();
          mPostingByDoc[`${sDoc}::${sYear}`] = this._fromODataV2Date(this._pickFirstValue(oHeader, ['PostingDate', 'postingDate']) || null);
        });
        aRows.forEach((oRow) => {
          oRow.grnPostingDate = mPostingByDoc[`${oRow.grnNumber}::${oRow.grnYear}`] || null;
        });
      } catch (e) {
        cds.log('gatepass-report').warn(`GR header posting-date lookup failed for PO ${sPONumber}. GRN posting dates will be blank. ${e.message}`);
      }
    }
    return aRows;
  }

  _buildGatePassReportRows(oEntry, oExit, mGRMaps) {
    const bIsOutward = (oEntry.movementType || '').toString().trim().toUpperCase() === 'O';
    const sReferenceNumber = (oEntry.referenceNumber || '').toString().trim();
    const aItems = this._parseMaterialItemsJson(oEntry.materialItemsJson);
    const fnBaseRow = () => ({
      gateEntryNumber: oEntry.gateEntryNumber || '',
      entryDate: oEntry.entryDate || null,
      purchasingDocNo: bIsOutward ? '' : sReferenceNumber,
      poItem: '',
      plant: oEntry.plant || '',
      materialNumber: '',
      materialDescription: '',
      poQuantity: null,
      poUnit: '',
      vendorCode: oEntry.partyNumber || '',
      vendorName: oEntry.partyName || '',
      invoiceNumber: bIsOutward ? sReferenceNumber : (oEntry.invoiceNumberRaw || ''),
      invoiceDate: oEntry.invoiceDate || null,
      vehicleNumber: oEntry.vehicleNumber || '',
      vehicleType: oEntry.vehicleType || '',
      transportNo: oEntry.transporterNumber || '',
      transportName: oEntry.transporterName || '',
      lrNumber: oEntry.lrNumber || '',
      challanQty: null,
      balanceQty: null,
      grnNumber: '',
      grnYear: '',
      grnPostingDate: null,
      grnStorageLocation: '',
      grnQuantity: null,
      gateExitNumber: oExit?.gateExitNumber || '',
      exitDate: oExit?.exitDate || null
    });

    if (!aItems.length) {
      return [fnBaseRow()];
    }
    const aRows = [];
    aItems.forEach((oItem) => {
      const nPOQty = this._toNumber(oItem.quantity);
      const sItemNo = this._normalizePOItemNumber(oItem.orderItemNumber);
      const sGEKey = sItemNo && oEntry.gateEntryNumber ? `${oEntry.gateEntryNumber}::${sItemNo}` : '';
      const sPOKey = bIsOutward || !sReferenceNumber || !sItemNo
        ? ''
        : `${sReferenceNumber}::${sItemNo}`;
      // Prefer exact gate-entry match (YY1_GatePassNo_MMI on the material doc item);
      // fall back to PO+item for GRs posted before that field existed
      let aGRRows = (sGEKey && mGRMaps.byGEItem[sGEKey]) || [];
      if (!aGRRows.length && sPOKey) {
        aGRRows = mGRMaps.byPOItem[sPOKey] || [];
      }
      // Balance Qty = PO Qty - Challan Qty
      const nChallanQty = this._toNumber(oItem.challanQuantity);
      const nBalance = Number.isFinite(nPOQty)
        ? Math.round((nPOQty - (Number.isFinite(nChallanQty) ? nChallanQty : 0)) * 1000) / 1000
        : null;
      const fnItemRow = () => ({
        ...fnBaseRow(),
        poItem: (oItem.orderItemNumber || '').toString(),
        plant: (oItem.plant || oEntry.plant || ''),
        materialNumber: oItem.materialCode || '',
        materialDescription: oItem.materialDescription || '',
        poQuantity: nPOQty,
        poUnit: oItem.unitOfMeasure || '',
        challanQty: nChallanQty,
        balanceQty: nBalance
      });
      if (!aGRRows.length) {
        aRows.push(fnItemRow());
        return;
      }
      aGRRows.forEach((oGR) => {
        aRows.push({
          ...fnItemRow(),
          grnNumber: oGR.grnNumber,
          grnYear: oGR.grnYear,
          grnPostingDate: oGR.grnPostingDate,
          grnStorageLocation: oGR.grnStorageLocation || (oItem.storageLocation || ''),
          grnQuantity: oGR.grnQuantity
        });
      });
    });
    return aRows;
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
    if (this._preferMockPOInLocalAutoMode(sMode)) {
      return this._getMockPORows(sPONumber);
    }
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

  async _fetchPOHeaderText(poNumber, req) {
    const sPONumber = (poNumber || '').toString().trim();
    if (!sPONumber) {
      return '';
    }

    const sMode = this._getPOSourceMode();
    if (this._preferMockPOInLocalAutoMode(sMode)) {
      return this._getMockPOHeaderText(sPONumber);
    }
    if (sMode === 'mock') {
      return this._getMockPOHeaderText(sPONumber);
    }
    if (sMode === 'live') {
      return this._fetchLivePOHeaderText(sPONumber, req);
    }

    try {
      return await this._fetchLivePOHeaderText(sPONumber, req);
    } catch (e) {
      cds.log('gatepass-po').warn(`Live PO header text lookup failed for ${sPONumber}. Falling back to mock. ${e.message}`);
      return this._getMockPOHeaderText(sPONumber);
    }
  }

  _getMockPOHeaderText(poNumber) {
    const aMockRows = this._getMockPORows(poNumber);
    if (!aMockRows.length) {
      return '';
    }
    const sHeaderText = this._pickFirstValue(aMockRows[0], [
      'po_header_text',
      'headerText',
      'purchase_order_header_text',
      'plain_long_text'
    ]) || '';
    return this._truncateMaterialDocumentHeaderText(sHeaderText);
  }

  async _fetchLivePOHeaderText(poNumber, req) {
    const sPONumber = (poNumber || '').toString().trim();
    if (!sPONumber) {
      return '';
    }
    const sPOServiceRoot = this._getPOServiceRoot();
    const sEscapedPONumber = this._escapeODataString(sPONumber);
    const sNotesPath = this._buildS4Path(
      sPOServiceRoot,
      `/PurchaseOrderNote?$filter=PurchaseOrder eq '${sEscapedPONumber}'&$select=PurchaseOrder,TextObjectType,Language,PlainLongText&$top=50`
    );
    const oPOService = await this._getPOService();
    const oRemoteClient = req ? oPOService.tx(req) : oPOService;
    const oResponse = await oRemoteClient.send({
      method: 'GET',
      path: sNotesPath
    });
    this._throwIfBlockingSAPMessages(oResponse, sPONumber);
    const aNotes = this._normalizeCollection(oResponse);
    const sHeaderText = aNotes
      .map((oNote) => (oNote?.PlainLongText || '').toString().trim())
      .find((sText) => !!sText) || '';
    return this._truncateMaterialDocumentHeaderText(sHeaderText);
  }

  _truncateMaterialDocumentHeaderText(vText) {
    const sText = (vText || '').toString().trim();
    if (!sText) {
      return '';
    }
    return sText.slice(0, 25);
  }

  _preferMockPOInLocalAutoMode(sMode) {
    if (sMode !== 'auto') {
      return false;
    }
    if (process.env.PO_SOURCE) {
      return false;
    }
    const bRunningInCF = !!process.env.VCAP_APPLICATION || !!process.env.VCAP_SERVICES;
    return !bRunningInCF;
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
    const sItemsPath = this._buildS4Path(sPOServiceRoot, `/PurchaseOrderItem?$filter=PurchaseOrder eq '${sEscapedPONumber}'&$select=PurchaseOrder,PurchaseOrderItem,Material,PurchaseOrderItemText,OrderQuantity,Plant,PurchaseOrderQuantityUnit,PurchaseRequisition,PurchaseRequisitionItem,NetPriceAmount,OrderPriceUnit`);
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

  async _getBillingService() {
    if (this._billingService) {
      return this._billingService;
    }
    this._billingService = await cds.connect.to('billingdocument_api');
    return this._billingService;
  }

  async _fetchGoodsReceiptOpenItems(poNumber, req) {
    const sPONumber = (poNumber || '').toString().trim();
    if (!sPONumber) {
      return [];
    }
    try {
      const aRows = await this._fetchPORows(sPONumber, req);
      return aRows
        .map((oRow) => this._mapGROpenItem(oRow, sPONumber))
        .filter((oRow) => oRow.purchaseOrderItem && !oRow.deliveryStatus);
    } catch (e) {
      cds.log('gatepass-gr').error(`Failed to derive Goods Receipt candidates for PO ${sPONumber}: ${e.message}`);
      if (e?.reason?.response?.body || e?.response?.body) {
        cds.log('gatepass-gr').error(JSON.stringify(e.reason?.response?.body || e.response?.body));
      }
      throw e;
    }
  }
  _mapGROpenItem(oRow, poNumber) {
    return {
      purchaseRequisition: this._pickFirstValue(oRow, ['purchase_requisition', 'PurchaseRequisition', 'purchaseRequisition']) || '',
      purchaseOrder: this._pickFirstValue(oRow, ['po_no', 'PurchaseOrder', 'purchaseOrder']) || poNumber || '',
      purchaseOrderItem: this._normalizePOItemNumber(this._pickFirstValue(oRow, ['item_no', 'PurchaseOrderItem', 'purchaseOrderItem']) || ''),
      purchaseRequisitionItem: this._pickFirstValue(oRow, ['purchase_requisition_item', 'PurchaseRequisitionItem', 'purchaseRequisitionItem']) || '',
      deliveredQuantity: Number(this._pickFirstValue(oRow, ['delivered_quantity', 'DeliveredQuantity', 'deliveredQuantity']) || 0),
      deliveryStatus: this._toBoolean(this._pickFirstValue(oRow, ['delivery_status', 'DeliveryStatus', 'deliveryStatus']) || false),
      purchaseOrderQuantityUnit: this._pickFirstValue(oRow, ['purchase_order_quantity_unit', 'PurchaseOrderQuantityUnit', 'purchaseOrderQuantityUnit']) || '',
      orderQuantityUnitISOCode: this._pickFirstValue(oRow, ['order_quantity_unit_iso_code', 'OrderQuantityUnitISOCode', 'orderQuantityUnitISOCode']) || '',
      plant: this._pickFirstValue(oRow, ['plant', 'Plant']) || '',
      material: this._pickFirstValue(oRow, ['material_no', 'Material', 'material']) || '',
      storageLocation: this._pickFirstValue(oRow, ['storage_location', 'StorageLocation', 'storageLocation']) || ''
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
  _getDefaultGRStorageLocation() {
    return (
      process.env.S4_GR_STORAGE_LOCATION ||
      cds.env?.requires?.goodsreceipt_api?.storageLocation ||
      cds.env?.gatepass?.grStorageLocation ||
      ''
    ).toString().trim();
  }

  _unwrapODataPayload(payload) {
    if (!payload || typeof payload !== 'object') {
      return payload || {};
    }
    if (payload.d && typeof payload.d === 'object') {
      return payload.d;
    }
    return payload;
  }
  _getGRDestinationName() {
    return (
      process.env.S4_DESTINATION ||
      process.env.S4_API_DESTINATION ||
      cds.env?.requires?.goodsreceipt_api?.credentials?.destination ||
      ''
    ).toString().trim();
  }

  _getHeaderValue(headers, headerName) {
    if (!headers || typeof headers !== 'object') {
      return '';
    }
    const sNeedle = (headerName || '').toString().toLowerCase();
    if (!sNeedle) {
      return '';
    }
    for (const [sKey, vValue] of Object.entries(headers)) {
      if (sKey.toLowerCase() === sNeedle) {
        return vValue;
      }
    }
    return '';
  }

  _toCookieHeader(setCookieHeaderValue) {
    const aSetCookies = Array.isArray(setCookieHeaderValue)
      ? setCookieHeaderValue
      : (setCookieHeaderValue ? [setCookieHeaderValue] : []);
    return aSetCookies
      .map((vCookie) => String(vCookie || '').split(';')[0].trim())
      .filter(Boolean)
      .join('; ');
  }

  async _callPostGoodsReceiptWithExplicitCsrf(payload) {
    const sDestination = this._getGRDestinationName();
    if (!sDestination) {
      throw new Error('S/4 destination for goodsreceipt_api is not configured.');
    }
    const sGRServiceRoot = this._getGRServiceRoot();
    const sUrlPath = this._buildS4Path(sGRServiceRoot, '/A_MaterialDocumentHeader');

    const oFetchResponse = await executeHttpRequest(
      { destinationName: sDestination },
      {
        method: 'GET',
        url: sUrlPath,
        headers: {
          'x-csrf-token': 'Fetch',
          accept: 'application/json'
        }
      },
      { fetchCsrfToken: false }
    );

    const vTokenHeader = this._getHeaderValue(oFetchResponse?.headers, 'x-csrf-token');
    const sCsrfToken = Array.isArray(vTokenHeader) ? String(vTokenHeader[0] || '').trim() : String(vTokenHeader || '').trim();
    if (!sCsrfToken) {
      throw new Error('Failed to fetch CSRF token from API_MATERIAL_DOCUMENT_SRV.');
    }
    const sCookieHeader = this._toCookieHeader(this._getHeaderValue(oFetchResponse?.headers, 'set-cookie'));
    const oHeaders = {
      'x-csrf-token': sCsrfToken,
      'content-type': 'application/json',
      accept: 'application/json'
    };
    if (sCookieHeader) {
      oHeaders.cookie = sCookieHeader;
    }

    const oPostResponse = await executeHttpRequest(
      { destinationName: sDestination },
      {
        method: 'POST',
        url: sUrlPath,
        headers: oHeaders,
        data: payload
      },
      { fetchCsrfToken: false }
    );

    return oPostResponse?.data || {};
  }

  async _callPostGoodsReceipt(payload, req) {
    void req;
    return this._callPostGoodsReceiptWithExplicitCsrf(payload);
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
        purchase_requisition: '',
        purchase_requisition_item: '',
        purchase_order_quantity_unit: '',
        order_quantity_unit_iso_code: '',
        storage_location: '',
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
      net_price_amount: this._toNumber(this._pickFirstValue(oItem, ['NetPriceAmount', 'netPriceAmount'])),
      order_price_unit: this._toNumber(this._pickFirstValue(oItem, ['OrderPriceUnit', 'orderPriceUnit'])),
      purchase_requisition: this._pickFirstValue(oItem, ['PurchaseRequisition', 'purchaseRequisition']) || '',
      purchase_requisition_item: this._pickFirstValue(oItem, ['PurchaseRequisitionItem', 'purchaseRequisitionItem']) || '',
      purchase_order_quantity_unit: this._pickFirstValue(oItem, ['PurchaseOrderQuantityUnit', 'purchaseOrderQuantityUnit']) || '',
      order_quantity_unit_iso_code: this._pickFirstValue(oItem, ['OrderQuantityUnitISOCode', 'orderQuantityUnitISOCode']) || '',
      storage_location: this._pickFirstValue(oItem, ['StorageLocation', 'storageLocation']) || '',
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

  async _fetchSalesInvoiceDetails(invoiceNumber, req, options = {}) {
    const sInvoiceNumber = (invoiceNumber || '').toString().trim();
    if (!sInvoiceNumber) {
      return null;
    }

    const bPreferLocal = options.preferLocal === true;
    const bPersistSnapshot = !!options.persistSnapshot;
    const sGateEntryID = (options.gateEntryID || '').toString().trim() || null;

    let oSnapshot = null;
    if (bPreferLocal) {
      oSnapshot = await this._loadSalesInvoiceSnapshotFromLocal(sInvoiceNumber, sGateEntryID, req);
    }
    if (!oSnapshot) {
      try {
        oSnapshot = await this._fetchLiveSalesInvoiceSnapshot(sInvoiceNumber, req);
      } catch (e) {
        if (this._isRemoteNotFoundError(e)) {
          return null;
        }
        throw e;
      }
    }
    if (!oSnapshot) {
      return null;
    }
    if (bPersistSnapshot) {
      await this._upsertSalesInvoiceSnapshot(oSnapshot, sGateEntryID, req);
    }
    return oSnapshot;
  }

  async _loadSalesInvoiceSnapshotFromLocal(invoiceNumber, gateEntryID, req) {
    const sInvoiceNumber = (invoiceNumber || '').toString().trim();
    if (!sInvoiceNumber) {
      return null;
    }
    const { InvoiceHeaders, InvoiceItems } = this.entities;
    if (!InvoiceHeaders || !InvoiceItems) {
      return null;
    }
    const tx = cds.tx(req);
    let oHeader = null;
    if (gateEntryID) {
      oHeader = await tx.run(
        SELECT.one.from(InvoiceHeaders)
          .where({
            billingDocument: sInvoiceNumber,
            gateEntry_ID: gateEntryID
          })
      );
    }
    if (!oHeader) {
      oHeader = await tx.run(
        SELECT.one.from(InvoiceHeaders)
          .where({
            billingDocument: sInvoiceNumber
          })
          .orderBy('modifiedAt desc')
      );
    }
    if (!oHeader) {
      return null;
    }

    const aItems = await tx.run(
      SELECT.from(InvoiceItems)
        .where({ parent_ID: oHeader.ID })
        .orderBy('billingDocumentItem asc')
    );
    const aMappedItems = (aItems || []).map((oItem, iIndex) => ({
      itemNumber: iIndex + 1,
      materialCode: oItem.product || '',
      materialDescription: oItem.itemText || '',
      quantity: this._toNumber(oItem.billingQuantity) || 0,
      challanQuantity: null,
      unitOfMeasure: oItem.unit || '',
      orderItemNumber: oItem.billingDocumentItem || '',
      plant: oItem.plant || null,
      storageLocation: oItem.storageLocation || null
    }));
    const sPlantFromItems = (aItems || []).find((oItem) => (oItem?.plant || '').toString().trim())?.plant || '';
    return {
      billingDocument: oHeader.billingDocument || sInvoiceNumber,
      billingDocumentType: oHeader.billingDocumentType || '',
      invoiceDate: oHeader.billingDocumentDate || null,
      soldToParty: oHeader.soldToParty || '',
      payerParty: oHeader.payerParty || '',
      customerNumber: oHeader.partyNumber || oHeader.soldToParty || oHeader.payerParty || '',
      customerName: oHeader.partyName || '',
      vehicleNumber: oHeader.vehicleNumber || '',
      transactionCurrency: oHeader.transactionCurrency || '',
      totalNetAmount: this._toNumber(oHeader.totalNetAmount),
      totalGrossAmount: this._toNumber(oHeader.totalGrossAmount),
      totalTaxAmount: this._toNumber(oHeader.totalTaxAmount),
      plant: sPlantFromItems || '',
      items: aMappedItems,
      itemsJson: JSON.stringify(aMappedItems)
    };
  }

  async _fetchLiveSalesInvoiceSnapshot(invoiceNumber, req) {
    const sInvoiceNumber = (invoiceNumber || '').toString().trim();
    if (!sInvoiceNumber) {
      return null;
    }
    const sServiceRoot = this._getBillingServiceRoot();
    const sEscapedInvoice = this._escapeODataString(sInvoiceNumber);
    const sPath = this._buildS4Path(
      sServiceRoot,
      `/BillingDocument('${sEscapedInvoice}')?$select=BillingDocument,BillingDocumentType,BillingDocumentDate,DocumentReferenceID,SoldToParty,PayerParty,YY1_Customer_Name_BDH,YY1_VehicleNo_BDH,TransactionCurrency,TotalNetAmount,TotalGrossAmount,TotalTaxAmount&$expand=_Item($select=BillingDocumentItem,Product,BillingDocumentItemText,BillingQuantity,BillingQuantityUnitSAPCode,NetAmount,Plant,StorageLocation,YY1_TRANSPORTER2_GSTIN_BDI)&$format=json`
    );
    const oBillingService = await this._getBillingService();
    const oRemoteClient = req ? oBillingService.tx(req) : oBillingService;
    const oResponse = await oRemoteClient.send({
      method: 'GET',
      path: sPath
    });
    this._throwIfBlockingSAPMessages(oResponse, sInvoiceNumber);
    const oPayload = this._unwrapODataPayload(oResponse);
    return this._mapLiveSalesInvoicePayload(oPayload, sInvoiceNumber);
  }

  _mapLiveSalesInvoicePayload(payload, invoiceNumber) {
    const oRoot = Array.isArray(payload?.value) ? payload.value[0] : payload;
    if (!oRoot || typeof oRoot !== 'object') {
      return null;
    }
    // DocumentReferenceID is a BillingDocument header field (Reference / Delivery No) — stamp it on every line item
    const sDeliveryNumber = (this._pickFirstValue(oRoot, ['DocumentReferenceID', 'documentReferenceID']) || '').toString().trim();
    const aRawItems = this._normalizeCollection(oRoot._Item || oRoot.to_Item || oRoot.BillingDocumentItem);
    const aMappedItems = aRawItems.map((oItem, iIndex) => ({
      itemNumber: iIndex + 1,
      deliveryNumber: sDeliveryNumber,
      materialCode: this._pickFirstValue(oItem, ['Product', 'product']) || '',
      materialDescription: this._pickFirstValue(oItem, ['BillingDocumentItemText', 'billingDocumentItemText']) || '',
      quantity: this._toNumber(this._pickFirstValue(oItem, ['BillingQuantity', 'billingQuantity'])) || 0,
      challanQuantity: null,
      unitOfMeasure: this._pickFirstValue(oItem, ['BillingQuantityUnitSAPCode', 'billingQuantityUnitSAPCode']) || '',
      orderItemNumber: this._pickFirstValue(oItem, ['BillingDocumentItem', 'billingDocumentItem']) || '',
      plant: this._pickFirstValue(oItem, ['Plant', 'plant']) || null,
      storageLocation: this._pickFirstValue(oItem, ['StorageLocation', 'storageLocation']) || null,
      netAmount: this._toNumber(this._pickFirstValue(oItem, ['NetAmount', 'netAmount']))
    }));
    const sSoldToParty = this._pickFirstValue(oRoot, ['SoldToParty', 'soldToParty']) || '';
    const sPayerParty = this._pickFirstValue(oRoot, ['PayerParty', 'payerParty']) || '';
    const sPartyNumber = sSoldToParty || sPayerParty || '';
    const sPlantFromItems = (aMappedItems.find((oItem) => (oItem.plant || '').toString().trim()) || {}).plant || '';
    // YY1_TRANSPORTER2_GSTIN_BDI is item-level — take the first non-empty value as the transporter number
    const sTransporterNumber = (aRawItems
      .map((oItem) => this._pickFirstValue(oItem, ['YY1_TRANSPORTER2_GSTIN_BDI', 'yy1Transporter2GstinBdi']))
      .find((v) => (v || '').toString().trim()) || '').toString().trim();
    return {
      billingDocument: this._pickFirstValue(oRoot, ['BillingDocument', 'billingDocument']) || invoiceNumber,
      billingDocumentType: this._pickFirstValue(oRoot, ['BillingDocumentType', 'billingDocumentType']) || '',
      deliveryNumber: sDeliveryNumber,
      invoiceDate: this._normalizeDate(this._pickFirstValue(oRoot, ['BillingDocumentDate', 'billingDocumentDate']) || null),
      soldToParty: sSoldToParty,
      payerParty: sPayerParty,
      customerNumber: sPartyNumber,
      customerName: this._pickFirstValue(oRoot, ['YY1_Customer_Name_BDH', 'yy1CustomerNameBdh']) || '',
      vehicleNumber: this._pickFirstValue(oRoot, ['YY1_VehicleNo_BDH', 'yy1VehicleNoBdh']) || '',
      transporterNumber: sTransporterNumber,
      transactionCurrency: this._pickFirstValue(oRoot, ['TransactionCurrency', 'transactionCurrency']) || '',
      totalNetAmount: this._toNumber(this._pickFirstValue(oRoot, ['TotalNetAmount', 'totalNetAmount'])),
      totalGrossAmount: this._toNumber(this._pickFirstValue(oRoot, ['TotalGrossAmount', 'totalGrossAmount'])),
      totalTaxAmount: this._toNumber(this._pickFirstValue(oRoot, ['TotalTaxAmount', 'totalTaxAmount'])),
      plant: sPlantFromItems || '',
      items: aMappedItems,
      itemsJson: JSON.stringify(aMappedItems)
    };
  }

  async _upsertSalesInvoiceSnapshot(snapshot, gateEntryID, req) {
    const sBillingDocument = (snapshot?.billingDocument || '').toString().trim();
    if (!sBillingDocument) {
      return;
    }
    const { InvoiceHeaders, InvoiceItems } = this.entities;
    if (!InvoiceHeaders || !InvoiceItems) {
      return;
    }
    const tx = cds.tx(req);
    const sGateEntryID = (gateEntryID || '').toString().trim() || null;
    let oHeader = null;
    if (sGateEntryID) {
      oHeader = await tx.run(
        SELECT.one.from(InvoiceHeaders)
          .where({
            billingDocument: sBillingDocument,
            gateEntry_ID: sGateEntryID
          })
      );
    }
    if (!oHeader) {
      oHeader = await tx.run(
        SELECT.one.from(InvoiceHeaders)
          .where({
            billingDocument: sBillingDocument
          })
      );
    }

    const oHeaderPayload = {
      billingDocument: sBillingDocument,
      billingDocumentType: (snapshot.billingDocumentType || '').toString().trim() || null,
      billingDocumentDate: this._normalizeDate(snapshot.invoiceDate || null),
      soldToParty: (snapshot.soldToParty || '').toString().trim() || null,
      payerParty: (snapshot.payerParty || '').toString().trim() || null,
      partyNumber: (snapshot.customerNumber || '').toString().trim() || null,
      partyName: (snapshot.customerName || '').toString().trim() || null,
      vehicleNumber: (snapshot.vehicleNumber || '').toString().trim() || null,
      transactionCurrency: (snapshot.transactionCurrency || '').toString().trim() || null,
      totalNetAmount: this._toNumber(snapshot.totalNetAmount),
      totalGrossAmount: this._toNumber(snapshot.totalGrossAmount),
      totalTaxAmount: this._toNumber(snapshot.totalTaxAmount),
      gateEntry_ID: sGateEntryID
    };

    let sHeaderID = oHeader?.ID || null;
    if (sHeaderID) {
      await tx.run(
        UPDATE(InvoiceHeaders, sHeaderID).set(oHeaderPayload)
      );
    } else {
      const oInsertResult = await tx.run(
        INSERT.into(InvoiceHeaders).entries(oHeaderPayload)
      );
      sHeaderID = oInsertResult?.ID || oInsertResult?.[0]?.ID || null;
      if (!sHeaderID) {
        const oInserted = await tx.run(
          SELECT.one.from(InvoiceHeaders)
            .where({
              billingDocument: sBillingDocument
            })
            .orderBy('modifiedAt desc')
        );
        sHeaderID = oInserted?.ID || null;
      }
    }
    if (!sHeaderID) {
      return;
    }

    await tx.run(DELETE.from(InvoiceItems).where({ parent_ID: sHeaderID }));
    const aItems = Array.isArray(snapshot.items) ? snapshot.items : [];
    if (!aItems.length) {
      return;
    }
    const aItemPayload = aItems.map((oItem) => ({
      parent_ID: sHeaderID,
      billingDocumentItem: (oItem.orderItemNumber || '').toString().trim() || null,
      product: (oItem.materialCode || '').toString().trim() || null,
      itemText: (oItem.materialDescription || '').toString().trim() || null,
      billingQuantity: this._toNumber(oItem.quantity),
      unit: (oItem.unitOfMeasure || '').toString().trim() || null,
      netAmount: this._toNumber(oItem.netAmount),
      plant: (oItem.plant || '').toString().trim() || null,
      storageLocation: (oItem.storageLocation || '').toString().trim() || null
    }));
    await tx.run(INSERT.into(InvoiceItems).entries(aItemPayload));
  }

  _applySalesInvoiceSnapshotToGateEntryData(data, snapshot) {
    if (!data || !snapshot) {
      return;
    }
    const sPartyNumber = (snapshot.customerNumber || '').toString().trim();
    const sPartyName = (snapshot.customerName || '').toString().trim();
    const sPlant = (snapshot.plant || '').toString().trim();
    const sVehicleNumber = (snapshot.vehicleNumber || '').toString().trim();
    const sInvoiceDate = this._normalizeDate(snapshot.invoiceDate || null);
    if (sPlant) {
      data.plant = sPlant;
    }
    if (sPartyNumber) {
      data.partyNumber = sPartyNumber;
    }
    if (sPartyName) {
      data.partyName = sPartyName;
    }
    if (!data.vehicleNumber && sVehicleNumber) {
      data.vehicleNumber = sVehicleNumber;
    }
    const sSnapshotTransporterNumber = (snapshot.transporterNumber || '').toString().trim();
    if (!data.transporterNumber && sSnapshotTransporterNumber) {
      data.transporterNumber = sSnapshotTransporterNumber;
    }
    if (!data.invoiceDate && sInvoiceDate) {
      data.invoiceDate = sInvoiceDate;
    }
    if (!data.invoiceValue && data.referenceNumber) {
      data.invoiceValue = data.referenceNumber;
    }
    if (Array.isArray(snapshot.items) && snapshot.items.length) {
      data.materialItemsJson = JSON.stringify(this._compactMaterialItemsForCBO(snapshot.items.map((oItem, iIndex) => ({
        itemNumber: iIndex + 1,
        deliveryNumber: (oItem.deliveryNumber || snapshot.deliveryNumber || '').toString(),
        materialCode: oItem.materialCode || '',
        materialDescription: oItem.materialDescription || '',
        quantity: Number(oItem.quantity || 0),
        challanQuantity: null,
        unitOfMeasure: oItem.unitOfMeasure || '',
        orderItemNumber: oItem.orderItemNumber || '',
        plant: oItem.plant || null,
        storageLocation: oItem.storageLocation || null,
        batch: '',
        dateOfManufacture: null
      })), (data.movementType || '').toString().trim().toUpperCase() === 'O'));
    }
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

  _getCurrentTimeHHMMSS() {
    const oNow = new Date();
    const h = String(oNow.getHours()).padStart(2, '0');
    const m = String(oNow.getMinutes()).padStart(2, '0');
    const s = String(oNow.getSeconds()).padStart(2, '0');
    return `${h}:${m}:${s}`;
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
