const cds = require('@sap/cds');
const { executeHttpRequest } = require('@sap-cloud-sdk/http-client');
const aPOMockData = require('./mock/po-mock-data.json');
const GR_TRACKER_ENTITY = 'com.mdasad.gatepass.POGoodsReceiptYearly';

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
    this.on('getPurchaseOrderReceivedSnapshot', this._onGetPurchaseOrderReceivedSnapshot);
    this.on('getGoodsReceiptOpenItems', this._onGetGoodsReceiptOpenItems);
    this.on('getSalesInvoiceDetails', this._onGetSalesInvoiceDetails);
    return super.init();
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

  _extractGateEntrySequence(vGateEntryNumber) {
    const sValue = (vGateEntryNumber || '').toString().trim();
    if (!sValue) {
      return 0;
    }
    let oMatch = sValue.match(/^GE-(\d+)(?:-\d{8})?$/i);
    if (!oMatch) {
      oMatch = sValue.match(/^GE-(\d+)/i);
    }
    if (!oMatch) {
      return 0;
    }
    const nValue = Number.parseInt(oMatch[1], 10);
    return Number.isFinite(nValue) ? nValue : 0;
  }

  _formatDateSuffix(vDateLike) {
    const sNormalized = this._normalizeDate(vDateLike || new Date());
    if (this._isNormalizedDate(sNormalized)) {
      return sNormalized.replace(/-/g, '');
    }
    const oNow = new Date();
    const sYear = String(oNow.getFullYear());
    const sMonth = String(oNow.getMonth() + 1).padStart(2, '0');
    const sDay = String(oNow.getDate()).padStart(2, '0');
    return `${sYear}${sMonth}${sDay}`;
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
      const tx = cds.tx(req);
      const aRows = await tx.run(
        SELECT.from(GR_TRACKER_ENTITY)
          .columns('itemNumber', 'unitOfMeasure', 'receivedQuantity')
          .where({
            poNumber: sPONumber,
            grYear: nGRYear
          })
      );
      return (aRows || []).reduce((mAcc, oRow) => {
        const sItemNumber = this._normalizePOItemNumber(oRow?.itemNumber);
        const sUnit = this._normalizeUnitOfMeasure(oRow?.unitOfMeasure);
        const nQty = this._toNumber(oRow?.receivedQuantity) || 0;
        if (!sItemNumber || !sUnit || nQty <= 0) {
          return mAcc;
        }
        const sKey = this._buildGRTrackerKey(sItemNumber, sUnit);
        mAcc[sKey] = (mAcc[sKey] || 0) + nQty;
        return mAcc;
      }, {});
    } catch (e) {
      cds.log('gatepass-po').warn(`GR tracker table not available for PO ${sPONumber}. Returning empty tracker. ${e.message}`);
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

  async _upsertPOGRTrackerFromPostedItems(poNumber, materialDocItems, postingYear, postingDate, req) {
    const sPONumber = (poNumber || '').toString().trim();
    const nPostingYear = Number.parseInt(postingYear, 10);
    const sPostingDate = this._normalizeDate(postingDate || new Date());
    const aItems = Array.isArray(materialDocItems) ? materialDocItems : [];
    if (!sPONumber || !Number.isInteger(nPostingYear) || !aItems.length) {
      return;
    }
    try {

    const mIncrements = {};
    aItems.forEach((oItem) => {
      const sItemNumber = this._normalizePOItemNumber(oItem?.PurchaseOrderItem);
      const sUnit = this._normalizeUnitOfMeasure(oItem?.EntryUnit);
      const nQty = this._toNumber(oItem?.QuantityInEntryUnit);
      if (!sItemNumber || !sUnit || nQty === null || nQty <= 0) {
        return;
      }
      const sKey = this._buildGRTrackerKey(sItemNumber, sUnit);
      mIncrements[sKey] = (mIncrements[sKey] || 0) + nQty;
    });
    const aKeys = Object.keys(mIncrements);
    if (!aKeys.length) {
      return;
    }

    const tx = cds.tx(req);
    for (const sKey of aKeys) {
      const [sItemNumber, sUnit] = sKey.split('::');
      const nIncrement = mIncrements[sKey] || 0;
      if (!sItemNumber || !sUnit || nIncrement <= 0) {
        continue;
      }
      const oWhere = {
        poNumber: sPONumber,
        itemNumber: sItemNumber,
        unitOfMeasure: sUnit,
        grYear: nPostingYear
      };
      const oExisting = await tx.run(
        SELECT.one.from(GR_TRACKER_ENTITY)
          .columns('receivedQuantity')
          .where(oWhere)
      );
      if (oExisting) {
        const nExisting = this._toNumber(oExisting.receivedQuantity) || 0;
        await tx.run(
          UPDATE(GR_TRACKER_ENTITY)
            .set({
              receivedQuantity: Number((nExisting + nIncrement).toFixed(3)),
              lastPostingDate: sPostingDate
            })
            .where(oWhere)
        );
      } else {
        await tx.run(
          INSERT.into(GR_TRACKER_ENTITY).entries({
            ...oWhere,
            receivedQuantity: Number(nIncrement.toFixed(3)),
            lastPostingDate: sPostingDate
          })
        );
      }
    }
    } catch (e) {
      cds.log('gatepass-gr').warn(`GR tracker table not available for upsert. ${e.message}`);
    }
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
    oRequires.goodsreceipt_api = oRequires.goodsreceipt_api || { kind: 'odata-v2', credentials: {} };
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
    return this._normalizeServiceRoot(sConfigured, '/sap/opu/odata4/sap/api_purchaseorder_2/srvd_a2x/sap/purchaseorder/0001');
  }

  _getGRServiceRoot() {
    const sConfigured = process.env.S4_GR_SERVICE_ROOT ||
      cds.env?.requires?.goodsreceipt_api?.serviceRoot;
    return this._normalizeServiceRoot(sConfigured, '/sap/opu/odata/sap/API_MATERIAL_DOCUMENT_SRV');
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

  /**
   * Before CREATE Gate Entry — generate number, validate mandatory fields
   */
  async _onBeforeCreateGateEntry(req) {
    const { GateEntries } = this.entities;
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

    // Set Gate Entry Year if not provided
    if (!data.gateEntryYear) {
      data.gateEntryYear = new Date().getFullYear();
    }

    // Generate Gate Entry Number with date suffix for newly created records (if not supplied by caller)
    if (!data.gateEntryNumber) {
      const aExistingNumbers = await SELECT.from(GateEntries)
        .columns('gateEntryNumber')
        .where({ gateEntryNumber: { like: 'GE-%' } });
      const nLastSeq = (aExistingNumbers || []).reduce((nMax, oRow) => {
        const nSeq = this._extractGateEntrySequence(oRow?.gateEntryNumber);
        return nSeq > nMax ? nSeq : nMax;
      }, 0);
      const nNextSeq = nLastSeq + 1;
      const sDateSuffix = this._formatDateSuffix(data.entryDate);
      data.gateEntryNumber = `GE-${String(nNextSeq).padStart(6, '0')}-${sDateSuffix}`;
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
    const data = req.data || {};
    if (Object.prototype.hasOwnProperty.call(data, 'entryTime')) {
      data.entryTime = this._normalizeTime(data.entryTime);
      if (!data.entryTime) {
        data.entryTime = this._getCurrentTimeHHMMSS();
      }
    }
    const { ID } = data;
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
    if (!data.invoiceDate) {
      return req.error(400, 'Invoice Date is mandatory');
    }
    const sInvoiceValueInput = (data.invoiceValue !== null && data.invoiceValue !== undefined)
      ? String(data.invoiceValue).trim()
      : '';
    if (!sInvoiceValueInput) {
      return req.error(400, 'Invoice No. is mandatory');
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
    const sReferenceType = data.referenceType !== undefined
      ? ((data.referenceType || '').toString().trim() || null)
      : (entry.referenceType || null);
    const sReferenceNumber = data.referenceNumber !== undefined
      ? ((data.referenceNumber || '').toString().trim() || null)
      : (entry.referenceNumber || null);
    let sPlant = data.plant !== undefined
      ? ((data.plant || '').toString().trim() || null)
      : (entry.plant || null);
    let sPartyNumber = data.partyNumber !== undefined
      ? ((data.partyNumber || '').toString().trim() || null)
      : (entry.partyNumber || null);
    let sPartyName = data.partyName !== undefined
      ? ((data.partyName || '').toString().trim() || null)
      : (entry.partyName || null);
    const sInvoiceValue = sInvoiceValueInput
      ? sInvoiceValueInput
      : null;
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

    // CR004: Validate and normalize items JSON payload + mandatory challan quantity
    let sItemsJson = null;
    if (data.itemsJson) {
      try {
        const parsed = typeof data.itemsJson === 'string' ? JSON.parse(data.itemsJson) : data.itemsJson;
        const aItems = Array.isArray(parsed) ? parsed : [];
        const aValidatedItems = aItems.map((oItem, iIndex) => {
          const oRow = oItem || {};
          const nChallanQty = Number(oRow.challanQuantity);
          const sBatch = (oRow.batch || '').toString().trim();
          const sStorageLocation = (oRow.storageLocation || '').toString().trim();
          const sPlant = (oRow.plant || '').toString().trim();
          const sDateOfManufacture = this._normalizeDate(oRow.dateOfManufacture);
          if (!Number.isFinite(nChallanQty) || nChallanQty <= 0) {
            throw new Error(`CHALLAN_QTY_INVALID:${iIndex + 1}`);
          }
          if (sDateOfManufacture && !this._isNormalizedDate(sDateOfManufacture)) {
            throw new Error(`DATE_OF_MANUFACTURE_INVALID:${iIndex + 1}`);
          }
          return {
            ...oRow,
            challanQuantity: nChallanQty,
            storageLocation: sStorageLocation || null,
            plant: sPlant || null,
            batch: sBatch || null,
            dateOfManufacture: sDateOfManufacture && this._isNormalizedDate(sDateOfManufacture)
              ? sDateOfManufacture
              : null
          };
        });
        sItemsJson = JSON.stringify(aValidatedItems);
      } catch (e) {
        if (e && typeof e.message === 'string' && e.message.startsWith('CHALLAN_QTY_INVALID:')) {
          const sIndex = e.message.split(':')[1] || '?';
          return req.error(400, `Challan Quantity must be greater than zero for item ${sIndex}`);
        }
        if (e && typeof e.message === 'string' && e.message.startsWith('DATE_OF_MANUFACTURE_INVALID:')) {
          const sIndex = e.message.split(':')[1] || '?';
          return req.error(400, `Date of Manufacture is invalid for item ${sIndex}`);
        }
        return req.error(400, 'Material items payload is invalid');
      }
    }

    // CR004: Only PO entries with an actual PO number go to CREATED.
    // Without-PO (blank PO number) and non-PO flows remain PARKED.
    const bHasPOReference = sReferenceType === 'PO' && !!sReferenceNumber;
    const sNewEntryStatus = bHasPOReference ? 'CREATED' : 'PARKED';

    await UPDATE(GateEntries, entry.ID).set({
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
    const {
      gateEntryID,
      gatePassID,
      exitDate,
      exitTime,
      clientTimezoneOffsetMinutes,
      securityOfficer,
      remarks
    } = req.data || {};
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
    if (entry.entryStatus !== 'CREATED' && entry.entryStatus !== 'PASS_ISSUED' && entry.entryStatus !== 'PARKED') {
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

    // Create Gate Exit record
    const oExitPayload = {
      gateExitNumber,
      gateEntry_ID: gateEntryID,
      gateEntryNumber: entry.gateEntryNumber,
      exitDate: sExitDate,
      exitTime: sExitTime,
      securityOfficer: sSecurityOfficer
    };
    if (sRemarks) {
      oExitPayload.remarks = sRemarks;
    }
    if (pass && pass.ID) {
      oExitPayload.gatePass_ID = pass.ID;
      oExitPayload.gatePassNumber = pass.gatePassNumber;
    }
    await INSERT.into(GateExit).entries(oExitPayload);

    // CR004: PARKED entries keep PARKED after exit (until GR or manual closure).
    // Also treat legacy inward blank-PO entries as PARKED to avoid disappearing from GatePass flow.
    const sEntryReferenceType = (entry.referenceType || '').toString().trim().toUpperCase();
    const sEntryReferenceNumber = (entry.referenceNumber || '').toString().trim();
    const bLegacyWithoutPO = sEntryReferenceType === 'PO' && !sEntryReferenceNumber;
    const bKeepParkedAfterExit = entry.entryStatus === 'PARKED' || bLegacyWithoutPO;
    if (bKeepParkedAfterExit) {
      await UPDATE(GateEntries, gateEntryID).set({
        entryStatus: 'PARKED',
        documentStatus: 'CLOSED'
      });
    } else {
      await UPDATE(GateEntries, gateEntryID).set({
        entryStatus: 'EXITED',
        documentStatus: 'CLOSED'
      });
    }

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

    const oEntry = await SELECT.one.from(this.entities.GateEntries, gateEntryID).columns('*');
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
    const sInvoiceValue = (oEntry.invoiceValue || '').toString().trim();
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
      try {
        const parsedItems = JSON.parse(oEntry.materialItemsJson);
        aSavedItems = Array.isArray(parsedItems) ? parsedItems : [];
      } catch (e) {
        return req.error(400, 'Saved material item data is invalid for Goods Receipt posting');
      }
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
    const nPostingYear = oPostingDate.getFullYear();
    const sDefaultStorageLocation = this._getDefaultGRStorageLocation();
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
        GoodsMovementType: '101',
        GoodsMovementRefDocType: 'B',
        PurchaseOrder: (oOpenItem.purchaseOrder || sPONumber).toString(),
        PurchaseOrderItem: this._formatPOItemForMaterialDoc(oOpenItem.purchaseOrderItem || sItemNo),
        QuantityInEntryUnit: nQty.toFixed(3),
        EntryUnit: sEntryUnit,
        Plant: sPlant,
        StorageLocation: sStorageLocation
      };
      const sMaterial = (oOpenItem.material || '').toString().trim();
      if (sMaterial) {
        oMaterialDocItem.Material = sMaterial;
      }
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
      let bTrackerUpdated = true;
      try {
        await this._upsertPOGRTrackerFromPostedItems(sPONumber, aMaterialDocItems, nPostingYear, oPostingDate, req);
      } catch (trackerError) {
        bTrackerUpdated = false;
        oLog.error(`Local yearly GR tracker update failed for PO ${sPONumber}: ${trackerError.message}`);
      }
      oLog.info(`Goods Receipt posted for PO ${sPONumber}: ${sMatDoc}/${sMatYear}`);

      // CR004: After GR, transition entry to EXITED if it was previously exited (CLOSED) but held back as PARKED/CREATED waiting for PO/GR
      if (oEntry.entryStatus === 'PARKED' || oEntry.documentStatus === 'CLOSED') {
        await UPDATE(this.entities.GateEntries, gateEntryID).set({
          entryStatus: 'EXITED'
        });
      }

      return {
        success: true,
        materialDocument: sMatDoc,
        materialDocumentYear: sMatYear,
        postedItems: aMaterialDocItems.length,
        message: bTrackerUpdated
          ? `Goods Receipt posted for ${aMaterialDocItems.length} item(s)`
          : `Goods Receipt posted for ${aMaterialDocItems.length} item(s); local yearly tracker update failed`
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
    const sItemsPath = this._buildS4Path(sPOServiceRoot, `/PurchaseOrderItem?$filter=PurchaseOrder eq '${sEscapedPONumber}'&$select=PurchaseOrder,PurchaseOrderItem,Material,PurchaseOrderItemText,OrderQuantity,Plant,PurchaseOrderQuantityUnit,PurchaseRequisition,PurchaseRequisitionItem`);
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
