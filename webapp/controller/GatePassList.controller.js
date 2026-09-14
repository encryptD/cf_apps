sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageToast",
    "sap/m/MessageBox",
    "sap/base/Log"
], function (Controller, JSONModel, MessageToast, MessageBox, Log) {
    "use strict";

    return Controller.extend("com.mdasad.gatepass.controller.GatePassList", {

        _getCurrentTimeDate: function () {
            return new Date();
        },

        onInit: function () {
            var oModel = new JSONModel({
                mode: "Create",
                movementType: "I",
                gateEntry_ID: "",
                gateEntryNumber: "",
                referenceType: "",
                referenceNumber: "",
                partyNumber: "",
                partyName: "",
                invoiceDate: null,
                invoiceValue: "",
                eWayBillNumber: "",
                eWayBillDate: null,
                shippingAddress: "",
                vehicleNumber: "",
                vehicleType: "",
                transporterName: "",
                driverName: "",
                lrNumber: "",
                passDate: new Date(),
                passTime: this._getCurrentTimeDate(),
                remarks: "",
                items: [],
                gateEntries: [],
                isGoodsReceiptEnabled: false,
                isGoodsReceiptBusy: false,
                isReferenceBusy: false,
                selectedGRItems: [],
                grOpenItemsByOrderItem: {},
                showChallanColumn: true,
                showPlantColumn: true,
                showStorageLocationColumn: true
            });
            this.getView().setModel(oModel, "pass");
            this._mPOItemsByNumber = {};
            this._mPOHeaderByNumber = {};
            this._mInvoiceSnapshotByNumber = {};
            this._mGROpenItemsByOrderItem = {};
            this._mStorageLocationsByPlant = {};
            this._iPOReferenceRequestSeq = 0;
            this._loadPlantLocationData();
            oModel.setProperty("/plantList", []);

            this.getOwnerComponent().getRouter().getRoute("GatePassList").attachPatternMatched(this._onRouteMatched, this);
        },

        _resolvePartyFromPO: function (sReferenceType, sReferenceNumber) {
            if (sReferenceType !== "PO" || !sReferenceNumber) {
                return null;
            }
            var oHeader = this._mPOHeaderByNumber[sReferenceNumber];
            if (oHeader) {
                var oModel = this.getView().getModel("pass");
                if (oHeader.plant) {
                    oModel.setProperty("/plant", oHeader.plant);
                }
                return oHeader;
            }
            return null;
        },

        _resolvePartyFromInvoice: function (sReferenceType, sReferenceNumber) {
            if (sReferenceType !== "SI" || !sReferenceNumber) {
                return null;
            }
            return this._mInvoiceSnapshotByNumber[sReferenceNumber] || null;
        },

        _fromEdmDate: function (v) {
            if (!v) {
                return null;
            }
            var d = v instanceof Date ? v : new Date(v);
            return Number.isNaN(d.getTime()) ? null : d;
        },

        _fromEdmTime: function (v) {
            if (!v) {
                return null;
            }
            if (v instanceof Date && !Number.isNaN(v.getTime())) {
                return v;
            }
            if (typeof v === "string") {
                var m = v.match(/^(\d{2}):(\d{2})(?::(\d{2}))?$/);
                if (m) {
                    var d = new Date();
                    d.setHours(parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3] || "0", 10), 0);
                    return d;
                }
            }
            return null;
        },

        _getI18nText: function (sKey, aArgs, sFallback) {
            var oI18nModel = this.getView().getModel("i18n") || this.getOwnerComponent().getModel("i18n");
            if (!oI18nModel) {
                return sFallback || sKey;
            }
            return oI18nModel.getResourceBundle().getText(sKey, aArgs || []);
        },

        _normalizeOrderItemNumber: function (vValue) {
            var sRaw = (vValue || "").toString().trim();
            if (!sRaw) {
                return "";
            }
            var sDigits = sRaw.replace(/[^0-9]/g, "");
            if (!sDigits) {
                return sRaw.toUpperCase();
            }
            return sDigits.padStart(5, "0").slice(-5);
        },

        _clearItemsTableSelection: function () {
            var oTable = this.byId("itemsTable");
            if (oTable && oTable.clearSelection) {
                oTable.clearSelection();
            }
        },

        _applyGoodsReceiptSelectionState: function () {
            var oModel = this.getView().getModel("pass");
            var oTable = this.byId("itemsTable");
            var aItems = oModel.getProperty("/items") || [];
            var sReferenceType = oModel.getProperty("/referenceType");
            var sMovementType = oModel.getProperty("/movementType");
            var aSelectedItems = [];
            if (oTable && oTable.getSelectedIndices) {
                oTable.getSelectedIndices().forEach(function (iIndex) {
                    var oItem = aItems[iIndex];
                    if (!oItem) {
                        return;
                    }
                    if (!oItem.grSelectable) {
                        return;
                    }
                    aSelectedItems.push({
                        orderItemNumber: oItem.orderItemNumber,
                        challanQuantity: oItem.challanQuantity,
                        storageLocation: oItem.storageLocation || "",
                        plant: oItem.plant || "",
                        batch: oItem.batch || "",
                        dateOfManufacture: oItem.dateOfManufacture || null
                    });
                });
            }
            var bQtyValid = aSelectedItems.length > 0 && aSelectedItems.every(function (oItem) {
                return Number(oItem.challanQuantity) > 0;
            });
            oModel.setProperty("/selectedGRItems", aSelectedItems);
            oModel.setProperty("/isGoodsReceiptEnabled", sMovementType === "I" && sReferenceType === "PO" && !oModel.getProperty("/isGoodsReceiptBusy") && bQtyValid);
        },

        _applyGoodsReceiptEligibilityToItems: function () {
            var oModel = this.getView().getModel("pass");
            var aItems = oModel.getProperty("/items") || [];
            var sReferenceType = oModel.getProperty("/referenceType");
            var sMovementType = oModel.getProperty("/movementType");
            var mOpenByItem = this._mGROpenItemsByOrderItem || {};
            var aUpdated = aItems.map(function (oItem) {
                var sItemNo = this._normalizeOrderItemNumber(oItem.orderItemNumber);
                return Object.assign({}, oItem, {
                    grSelectable: sMovementType === "I" && sReferenceType === "PO" && !!mOpenByItem[sItemNo]
                });
            }.bind(this));
            oModel.setProperty("/items", aUpdated);
            oModel.setProperty("/grOpenItemsByOrderItem", mOpenByItem);
            this._applyGoodsReceiptSelectionState();
        },

        _loadGoodsReceiptOpenItemsForCurrentReference: function () {
            var oModel = this.getView().getModel("pass");
            var sReferenceType = oModel.getProperty("/referenceType");
            var sReferenceNumber = (oModel.getProperty("/referenceNumber") || "").trim();
            var sMovementType = oModel.getProperty("/movementType");
            if (sMovementType !== "I" || sReferenceType !== "PO" || !sReferenceNumber) {
                this._mGROpenItemsByOrderItem = {};
                this._applyGoodsReceiptEligibilityToItems();
                return Promise.resolve();
            }

            var oODataModel = this.getView().getModel();
            if (!oODataModel) {
                this._mGROpenItemsByOrderItem = {};
                this._applyGoodsReceiptEligibilityToItems();
                return Promise.resolve();
            }
            var oFunction = oODataModel.bindContext("/getGoodsReceiptOpenItems(...)");
            oFunction.setParameter("poNumber", sReferenceNumber);
            var fnOnOpenItemsLoaded = function () {
                var oResult = oFunction.getBoundContext().getObject() || {};
                var aOpenItems = [];
                if (oResult.itemsJson) {
                    try {
                        aOpenItems = JSON.parse(oResult.itemsJson);
                    } catch (e) {
                        aOpenItems = [];
                    }
                }
                this._mGROpenItemsByOrderItem = {};
                aOpenItems.forEach(function (oOpenItem) {
                    var sItemNo = this._normalizeOrderItemNumber(oOpenItem.purchaseOrderItem);
                    if (sItemNo) {
                        this._mGROpenItemsByOrderItem[sItemNo] = oOpenItem;
                    }
                }.bind(this));
                this._applyGoodsReceiptEligibilityToItems();
            }.bind(this);
            var fnOnOpenItemsFailed = function () {
                this._mGROpenItemsByOrderItem = {};
                this._applyGoodsReceiptEligibilityToItems();
                MessageToast.show(this._getI18nText("grOpenItemsLoadFailed", null, "Could not load Goods Receipt open items"));
            }.bind(this);
            return oFunction.execute().then(fnOnOpenItemsLoaded).catch(fnOnOpenItemsFailed);
x        },

        _cachePORows: function (sPONumber, aRows) {
            var sKey = (sPONumber || "").toString();
            if (!sKey) {
                return;
            }
            var aSafeRows = Array.isArray(aRows) ? aRows.slice() : [];
            aSafeRows.sort(function (a, b) {
                var iA = Number(a.item_no);
                var iB = Number(b.item_no);
                if (Number.isNaN(iA)) {
                    iA = 0;
                }
                if (Number.isNaN(iB)) {
                    iB = 0;
                }
                return iA - iB;
            });
            this._mPOItemsByNumber[sKey] = aSafeRows;
            if (aSafeRows.length) {
                this._mPOHeaderByNumber[sKey] = {
                    partyNumber: aSafeRows[0].vendor || "",
                    partyName: aSafeRows[0].vendor_name || "",
                    plant: this._resolvePOPlant(aSafeRows[0])
                };
            }
        },

        _fetchPOSnapshot: function (sPONumber) {
            var oODataModel = this.getView().getModel();
            if (!oODataModel) {
                return Promise.reject(new Error("OData model is not available"));
            }
            var oFunction = oODataModel.bindContext("/getPurchaseOrderSnapshot(...)");
            oFunction.setParameter("poNumber", sPONumber);
            return oFunction.execute().then(function () {
                return oFunction.getBoundContext().getObject() || {};
            });
        },

        _cacheSalesInvoiceSnapshot: function (sInvoiceNumber, oSnapshot) {
            var sKey = (sInvoiceNumber || "").toString().trim();
            if (!sKey || !oSnapshot) {
                return;
            }
            var aItems = [];
            if (oSnapshot.itemsJson) {
                try {
                    aItems = JSON.parse(oSnapshot.itemsJson) || [];
                } catch (e) {
                    aItems = [];
                }
            }
            this._mInvoiceSnapshotByNumber[sKey] = {
                partyNumber: oSnapshot.customerNumber || "",
                partyName: oSnapshot.customerName || "",
                plant: oSnapshot.plant || "",
                items: Array.isArray(aItems) ? aItems : []
            };
        },

        _fetchSalesInvoiceSnapshot: function (sInvoiceNumber) {
            var oODataModel = this.getView().getModel();
            if (!oODataModel) {
                return Promise.reject(new Error("OData model is not available"));
            }
            var oFunction = oODataModel.bindContext("/getSalesInvoiceDetails(...)");
            oFunction.setParameter("invoiceNumber", sInvoiceNumber);
            return oFunction.execute().then(function () {
                return oFunction.getBoundContext().getObject() || {};
            });
        },

        _loadSalesInvoiceReferenceData: function (sReferenceType, sReferenceNumber, bSkipItemPopulate) {
            var sInvoiceNumber = (sReferenceNumber || "").toString().trim();
            var oModel = this.getView().getModel("pass");
            if (sReferenceType !== "SI" || !sInvoiceNumber) {
                oModel.setProperty("/isReferenceBusy", false);
                return Promise.resolve();
            }

            oModel.setProperty("/isReferenceBusy", true);
            var oCachedSnapshot = this._resolvePartyFromInvoice("SI", sInvoiceNumber);
            if (oCachedSnapshot) {
                oModel.setProperty("/partyNumber", oCachedSnapshot.partyNumber || "");
                oModel.setProperty("/partyName", oCachedSnapshot.partyName || "");
                if (oCachedSnapshot.plant) {
                    oModel.setProperty("/plant", oCachedSnapshot.plant);
                }
                if (!bSkipItemPopulate) {
                    this._populateItemsFromReference("SI", sInvoiceNumber);
                }
            }

            return this._fetchSalesInvoiceSnapshot(sInvoiceNumber).then(function (oSnapshot) {
                this._cacheSalesInvoiceSnapshot(sInvoiceNumber, oSnapshot);
                var bStillSelected = oModel.getProperty("/referenceType") === "SI" &&
                    (oModel.getProperty("/referenceNumber") || "") === sInvoiceNumber;
                if (!bStillSelected) {
                    return;
                }
                var oResolved = this._resolvePartyFromInvoice("SI", sInvoiceNumber) || {};
                oModel.setProperty("/partyNumber", oResolved.partyNumber || oModel.getProperty("/partyNumber"));
                oModel.setProperty("/partyName", oResolved.partyName || oModel.getProperty("/partyName"));
                if (oResolved.plant) {
                    oModel.setProperty("/plant", oResolved.plant);
                }
                if (!bSkipItemPopulate) {
                    this._populateItemsFromReference("SI", sInvoiceNumber);
                }
            }.bind(this)).catch(function () {
                // Keep existing values and cached fallback behavior
            }).finally(function () {
                oModel.setProperty("/isReferenceBusy", false);
                this._loadGoodsReceiptOpenItemsForCurrentReference();
                this._updatePlantColumnVisibility();
            }.bind(this));
        },

        _loadPOReferenceData: function (sReferenceType, sReferenceNumber, bSkipItemPopulate) {
            var sPONumber = (sReferenceNumber || "").toString().trim();
            var oModel = this.getView().getModel("pass");
            this._iPOReferenceRequestSeq = (this._iPOReferenceRequestSeq || 0) + 1;
            var iRequestSeq = this._iPOReferenceRequestSeq;
            var fnIsCurrentRequest = function () {
                return iRequestSeq === this._iPOReferenceRequestSeq;
            }.bind(this);
            if (sReferenceType !== "PO" || !sPONumber) {
                oModel.setProperty("/isReferenceBusy", false);
                this._loadGoodsReceiptOpenItemsForCurrentReference();
                this._updatePlantColumnVisibility();
                return Promise.resolve();
            }
            oModel.setProperty("/isReferenceBusy", true);

            var oCachedParty = this._resolvePartyFromPO("PO", sPONumber);
            if (oCachedParty && fnIsCurrentRequest()) {
                oModel.setProperty("/partyNumber", oCachedParty.partyNumber || "");
                oModel.setProperty("/partyName", oCachedParty.partyName || "");
                if (!bSkipItemPopulate) {
                    this._populateItemsFromReference("PO", sPONumber);
                }
            }

            return this._fetchPOSnapshot(sPONumber).then(function (oSnapshot) {
                if (!fnIsCurrentRequest()) {
                    return;
                }
                var aRows = [];
                if (oSnapshot.itemsJson) {
                    try {
                        aRows = JSON.parse(oSnapshot.itemsJson);
                    } catch (e) {
                        aRows = [];
                    }
                }
                this._cachePORows(sPONumber, aRows);

                var bStillSelected = oModel.getProperty("/referenceType") === "PO" &&
                    (oModel.getProperty("/referenceNumber") || "") === sPONumber;
                if (!bStillSelected) {
                    return;
                }
                var oResolvedHeader = this._resolvePartyFromPO("PO", sPONumber) || {};
                var sSnapshotPlant = (oSnapshot.plant || "").toString().trim();
                if (sSnapshotPlant) {
                    oModel.setProperty("/plant", sSnapshotPlant);
                } else if (oResolvedHeader.plant) {
                    oModel.setProperty("/plant", oResolvedHeader.plant);
                }
                oModel.setProperty("/partyNumber", oSnapshot.supplierNumber || oResolvedHeader.partyNumber || oModel.getProperty("/partyNumber"));
                oModel.setProperty("/partyName", oSnapshot.supplierName || oResolvedHeader.partyName || oModel.getProperty("/partyName"));
                if (!bSkipItemPopulate) {
                    this._populateItemsFromReference("PO", sPONumber);
                }
            }.bind(this)).catch(function () {
                // Keep existing values and cached fallback behavior
            }).finally(function () {
                if (!fnIsCurrentRequest()) {
                    return;
                }
                oModel.setProperty("/isReferenceBusy", false);
                this._loadGoodsReceiptOpenItemsForCurrentReference();
                this._updatePlantColumnVisibility();
            }.bind(this));
        },


        _populateItemsFromReference: function (sReferenceType, sReferenceNumber) {
            var oModel = this.getView().getModel("pass");
            if (!sReferenceNumber) {
                oModel.setProperty("/items", []);
                this._applyGoodsReceiptSelectionState();
                return;
            }
            if (sReferenceType === "SI") {
                var oInvoiceSnapshot = this._resolvePartyFromInvoice("SI", sReferenceNumber);
                var aInvoiceItems = (oInvoiceSnapshot && Array.isArray(oInvoiceSnapshot.items)) ? oInvoiceSnapshot.items : [];
                var aOutwardItems = aInvoiceItems.map(function (oItem, iIndex) {
                    return {
                        itemNumber: iIndex + 1,
                        materialCode: oItem.materialCode || "",
                        materialDescription: oItem.materialDescription || "",
                        quantity: oItem.quantity !== undefined && oItem.quantity !== null ? String(oItem.quantity) : "",
                        challanQuantity: "",
                        unitOfMeasure: oItem.unitOfMeasure || "",
                        orderItemNumber: oItem.orderItemNumber || "",
                        plant: oItem.plant || "",
                        plantOptions: [],
                        storageLocationOptions: [],
                        storageLocation: oItem.storageLocation || "",
                        batch: "",
                        dateOfManufacture: null,
                        grSelectable: false
                    };
                });
                oModel.setProperty("/items", aOutwardItems);
                this._applyGoodsReceiptSelectionState();
                return;
            }
            if (sReferenceType !== "PO") {
                oModel.setProperty("/items", []);
                this._applyGoodsReceiptSelectionState();
                return;
            }
            var aRows = this._mPOItemsByNumber[sReferenceNumber] || [];
            if (!aRows.length) {
                oModel.setProperty("/items", []);
                this._applyGoodsReceiptSelectionState();
                return;
            }
            var sHeaderPlant = (oModel.getProperty("/plant") || "").toString().trim();
            if (!sHeaderPlant) {
                sHeaderPlant = this._resolvePOPlant(aRows[0]);
                if (sHeaderPlant) {
                    oModel.setProperty("/plant", sHeaderPlant);
                }
            }
            var aPlantKeys = this._getAvailablePlantKeys();
            var aItems = aRows.map(function (oRow, iIndex) {
                var sItemPlant = this._resolvePOPlant(oRow) || sHeaderPlant;
                var aLocationOptions = this._getStorageLocationOptionsForPlant(sItemPlant);
                var sDefaultLocation = aLocationOptions.length ? aLocationOptions[0].key : "";
                return {
                    itemNumber: iIndex + 1,
                    materialCode: oRow.material_no || "",
                    materialDescription: oRow.material_description || "",
                    quantity: oRow.po_qty !== undefined && oRow.po_qty !== null ? String(oRow.po_qty) : "",
                    challanQuantity: "",
                    unitOfMeasure: this._resolvePOUnitOfMeasure(oRow),
                    orderItemNumber: oRow.item_no !== undefined && oRow.item_no !== null ? String(oRow.item_no) : "",
                    plant: sItemPlant,
                    plantOptions: aPlantKeys,
                    storageLocationOptions: aLocationOptions,
                    storageLocation: sDefaultLocation,
                    batch: "",
                    dateOfManufacture: null,
                    grSelectable: false
                };
            }.bind(this));
            oModel.setProperty("/items", aItems);
            this._applyGoodsReceiptSelectionState();
        },

        _onRouteMatched: function (oEvent) {
            this._clearForm();
            var oArguments = oEvent ? oEvent.getParameter("arguments") : {};
            this._loadOpenGateEntries().then(function () {
                this._prefillGateEntryFromRoute(oArguments);
            }.bind(this));
        },

        _clearForm: function () {
            var oModel = this.getView().getModel("pass");
            oModel.setProperty("/mode", "Create");
            oModel.setProperty("/movementType", "I");
            oModel.setProperty("/gateEntry_ID", "");
            oModel.setProperty("/gateEntryNumber", "");
            oModel.setProperty("/referenceType", "");
            oModel.setProperty("/referenceNumber", "");
            oModel.setProperty("/partyNumber", "");
            oModel.setProperty("/partyName", "");
            oModel.setProperty("/invoiceDate", null);
            oModel.setProperty("/invoiceValue", "");
            oModel.setProperty("/eWayBillNumber", "");
            oModel.setProperty("/eWayBillDate", null);
            oModel.setProperty("/shippingAddress", "");
            oModel.setProperty("/vehicleNumber", "");
            oModel.setProperty("/vehicleType", "");
            oModel.setProperty("/transporterName", "");
            oModel.setProperty("/driverName", "");
            oModel.setProperty("/lrNumber", "");
            oModel.setProperty("/passDate", new Date());
            oModel.setProperty("/passTime", this._getCurrentTimeDate());
            oModel.setProperty("/remarks", "");
            oModel.setProperty("/items", []);
            oModel.setProperty("/isGoodsReceiptEnabled", false);
            oModel.setProperty("/isGoodsReceiptBusy", false);
            oModel.setProperty("/isReferenceBusy", false);
            oModel.setProperty("/selectedGRItems", []);
            oModel.setProperty("/grOpenItemsByOrderItem", {});
            oModel.setProperty("/showChallanColumn", true);
            oModel.setProperty("/showPlantColumn", true);
            oModel.setProperty("/showStorageLocationColumn", true);
            this._iPOReferenceRequestSeq = (this._iPOReferenceRequestSeq || 0) + 1;
            this._mGROpenItemsByOrderItem = {};
            this._clearItemsTableSelection();
            this._updatePlantColumnVisibility();
        },

        _loadOpenGateEntries: function () {
            var oODataModel = this.getView().getModel();
            if (!oODataModel) {
                return Promise.resolve();
            }
            if (typeof oODataModel.refresh === "function") {
                oODataModel.refresh();
            }
            var oListBinding = oODataModel.bindList("/GateEntries", null, null, null, {
                $filter: "entryStatus eq 'CREATED' or entryStatus eq 'PARKED'"
            });
            return oListBinding.requestContexts(0, 500).then(function (aContexts) {
                var aOpenEntries = aContexts.map(function (oContext) {
                    return oContext.getObject();
                });
                aOpenEntries.unshift({
                    ID: "",
                    gateEntryNumber: "",
                    vehicleNumber: "",
                    partyName: ""
                });
                var oModel = this.getView().getModel("pass");
                oModel.setProperty("/gateEntries", aOpenEntries);
                Log.info("[GatePassPropagation] _loadOpenGateEntries loaded created entries", JSON.stringify({
                    count: aOpenEntries.length
                }), "com.mdasad.gatepass.controller.GatePassList");
            }.bind(this)).catch(function () {
                MessageToast.show("Could not load Gate Entries");
            });
        },

        _prefillGateEntryFromRoute: function (oArguments) {
            var oQuery = oArguments && oArguments["?query"] ? oArguments["?query"] : {};
            var sGateEntryId = oQuery.gateEntryId || "";
            var sGateEntryNumber = oQuery.gateEntryNumber || "";
            var aEntries = this.getView().getModel("pass").getProperty("/gateEntries") || [];
            var oMatch;

            Log.info("[GatePassPropagation] _prefillGateEntryFromRoute invoked", JSON.stringify({
                hasArguments: !!oArguments,
                query: oQuery,
                initialGateEntryId: sGateEntryId,
                initialGateEntryNumber: sGateEntryNumber,
                availableGateEntries: aEntries.length
            }), "com.mdasad.gatepass.controller.GatePassList");

            if (!sGateEntryId && sGateEntryNumber) {
                oMatch = aEntries.find(function (oEntry) {
                    return oEntry.gateEntryNumber === sGateEntryNumber;
                });
                sGateEntryId = oMatch && oMatch.ID;
                Log.info("[GatePassPropagation] Fallback lookup by gateEntryNumber completed", JSON.stringify({
                    gateEntryNumber: sGateEntryNumber,
                    foundMatch: !!oMatch,
                    resolvedGateEntryId: sGateEntryId || ""
                }), "com.mdasad.gatepass.controller.GatePassList");
            }

            if (!sGateEntryId) {
                Log.warning("[GatePassPropagation] Prefill aborted: no gateEntryId resolved", JSON.stringify({
                    query: oQuery,
                    availableGateEntries: aEntries.length
                }), "com.mdasad.gatepass.controller.GatePassList");
                return;
            }

            var oCombo = this.byId("gateEntryCombo");
            if (oCombo) {
                oCombo.setSelectedKey(sGateEntryId);
                Log.info("[GatePassPropagation] Combo selection set from route", JSON.stringify({
                    selectedKey: sGateEntryId,
                    comboSelectedKeyAfterSet: oCombo.getSelectedKey()
                }), "com.mdasad.gatepass.controller.GatePassList");
            } else {
                Log.warning("[GatePassPropagation] gateEntryCombo not found in view during prefill", "", "com.mdasad.gatepass.controller.GatePassList");
            }
            this._populateFromGateEntry(sGateEntryId);
        },

        _populateFromGateEntry: function (sGateEntryId) {
            if (!sGateEntryId) {
                Log.warning("[GatePassPropagation] _populateFromGateEntry skipped: empty gateEntryId", "", "com.mdasad.gatepass.controller.GatePassList");
                return;
            }
            var oModel = this.getView().getModel("pass");
            var oODataModel = this.getView().getModel();
            var aLoadedEntries = oModel.getProperty("/gateEntries") || [];
            var oLoadedMatch = aLoadedEntries.find(function (oEntry) {
                return oEntry.ID === sGateEntryId;
            });
            var bHadLoadedMatch = !!oLoadedMatch;

            if (oLoadedMatch) {
                this._applyGateEntryToPassModel(oLoadedMatch);
                Log.info("[GatePassPropagation] _populateFromGateEntry populated from loaded gateEntries", JSON.stringify({
                    gateEntryId: oLoadedMatch.ID,
                    gateEntryNumber: oLoadedMatch.gateEntryNumber,
                    movementType: oLoadedMatch.movementType,
                    referenceType: oLoadedMatch.referenceType
                }), "com.mdasad.gatepass.controller.GatePassList");
                return;
            }

            Log.info("[GatePassPropagation] _populateFromGateEntry fallback lookup from backend list", JSON.stringify({
                gateEntryId: sGateEntryId
            }), "com.mdasad.gatepass.controller.GatePassList");

            var oListBinding = oODataModel.bindList("/GateEntries");
            oListBinding.requestContexts(0, 1000).then(function (aContexts) {
                var aEntries = aContexts.map(function (oContext) {
                    return oContext.getObject();
                });
                var oMatch = aEntries.find(function (oEntry) {
                    return oEntry.ID === sGateEntryId;
                });

                if (!oMatch) {
                    throw new Error("Gate Entry not found for ID " + sGateEntryId);
                }

                this._applyGateEntryToPassModel(oMatch);
                Log.info("[GatePassPropagation] _populateFromGateEntry populated from backend fallback list", JSON.stringify({
                    gateEntryId: oMatch.ID,
                    gateEntryNumber: oMatch.gateEntryNumber,
                    movementType: oMatch.movementType,
                    referenceType: oMatch.referenceType
                }), "com.mdasad.gatepass.controller.GatePassList");
            }.bind(this)).catch(function () {
                Log.error("[GatePassPropagation] _populateFromGateEntry failed to fetch Gate Entry details", JSON.stringify({
                    gateEntryId: sGateEntryId
                }), "com.mdasad.gatepass.controller.GatePassList");
                if (!bHadLoadedMatch) {
                    MessageToast.show("Could not fetch Gate Entry details");
                }
            });
        },

        _applyGateEntryToPassModel: function (oData) {
            var oModel = this.getView().getModel("pass");
            var sMovementType = (oData.movementType || "I").toString().trim().toUpperCase();
            oModel.setProperty("/gateEntry_ID", oData.ID);
            oModel.setProperty("/gateEntryNumber", oData.gateEntryNumber);
            oModel.setProperty("/movementType", sMovementType);
            oModel.setProperty("/referenceType", oData.referenceType);
            oModel.setProperty("/referenceNumber", oData.referenceNumber);
            var oResolvedParty = oData.referenceType === "SI"
                ? this._resolvePartyFromInvoice(oData.referenceType, oData.referenceNumber)
                : this._resolvePartyFromPO(oData.referenceType, oData.referenceNumber);
            oModel.setProperty("/partyNumber", oResolvedParty ? oResolvedParty.partyNumber : oData.partyNumber);
            oModel.setProperty("/partyName", oResolvedParty ? oResolvedParty.partyName : oData.partyName);
            oModel.setProperty("/vehicleNumber", oData.vehicleNumber);
            oModel.setProperty("/vehicleType", oData.vehicleType);
            oModel.setProperty("/transporterName", oData.transporterName);
            oModel.setProperty("/driverName", oData.driverName);
            oModel.setProperty("/lrNumber", oData.lrNumber);
            oModel.setProperty("/invoiceDate", this._fromEdmDate(oData.invoiceDate));
            oModel.setProperty("/invoiceValue", oData.invoiceValue != null ? String(oData.invoiceValue) : "");
            oModel.setProperty("/eWayBillNumber", oData.eWayBillNumber || "");
            oModel.setProperty("/eWayBillDate", this._fromEdmDate(oData.eWayBillDate));
            oModel.setProperty("/shippingAddress", oData.shippingAddress || "");
            oModel.setProperty("/passDate", this._fromEdmDate(oData.passDate) || new Date());
            oModel.setProperty("/passTime", this._fromEdmTime(oData.passTime) || this._getCurrentTimeDate());
            oModel.setProperty("/remarks", oData.passRemarks || "");
            var bHasSavedItems = false;

            if (oData.materialItemsJson) {
                try {
                    var aSavedItems = JSON.parse(oData.materialItemsJson);
                    var aPlantKeys = this._getAvailablePlantKeys();
                    var aItems = (Array.isArray(aSavedItems) ? aSavedItems : []).map(function (oItem) {
                        var sItemPlant = (oItem.plant || "").toString().trim();
                        return Object.assign({}, oItem, {
                            plantOptions: sMovementType === "I" ? aPlantKeys : [],
                            storageLocationOptions: sMovementType === "I" ? this._getStorageLocationOptionsForPlant(sItemPlant) : []
                        });
                    }.bind(this));
                    oModel.setProperty("/items", aItems);
                    bHasSavedItems = true;
                } catch (e) {
                    // fall back to reference-based population below
                }
            }
            if (!bHasSavedItems) {
                this._populateItemsFromReference(oData.referenceType, oData.referenceNumber);
            }
            if (oData.referenceType === "PO") {
                this._loadPOReferenceData(oData.referenceType, oData.referenceNumber, bHasSavedItems);
            } else if (oData.referenceType === "SI") {
                this._loadSalesInvoiceReferenceData(oData.referenceType, oData.referenceNumber, bHasSavedItems);
            } else {
                this._loadGoodsReceiptOpenItemsForCurrentReference();
                this._updatePlantColumnVisibility();
            }
            this._updatePlantColumnVisibility();
        },

        _toEdmDate: function (oDate) {
            var y = oDate.getFullYear();
            var m = String(oDate.getMonth() + 1).padStart(2, "0");
            var d = String(oDate.getDate()).padStart(2, "0");
            return y + "-" + m + "-" + d;
        },

        _toEdmTime: function (oDate) {
            var h = String(oDate.getHours()).padStart(2, "0");
            var m = String(oDate.getMinutes()).padStart(2, "0");
            var s = String(oDate.getSeconds()).padStart(2, "0");
            return h + ":" + m + ":" + s;
        },

        _toOptionalEdmDate: function (v) {
            if (!v) {
                return null;
            }
            if (v instanceof Date && !Number.isNaN(v.getTime())) {
                return this._toEdmDate(v);
            }
            if (typeof v === "string") {
                var s = v.trim();
                if (!s) {
                    return null;
                }
                if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
                    return s;
                }
                var d = new Date(s);
                if (!Number.isNaN(d.getTime())) {
                    return this._toEdmDate(d);
                }
            }
            return null;
        },

        onGateEntryChange: function (oEvent) {
            var oSource = oEvent.getSource ? oEvent.getSource() : null;
            var sSelectedKey = oEvent.getParameter("selectedItem")?.getKey() || (oSource && oSource.getSelectedKey ? oSource.getSelectedKey() : "");
            if (!sSelectedKey) {
                return;
            }
            this._clearItemsTableSelection();
            this._populateFromGateEntry(sSelectedKey);
        },

        onReferenceNumberChange: function (oEvent) {
            var sValue = (oEvent.getParameter("value") || oEvent.getSource().getValue() || "").toString().trim();
            var oModel = this.getView().getModel("pass");
            oModel.setProperty("/referenceNumber", sValue);
            var sRefType = oModel.getProperty("/referenceType");
            var sMovementType = oModel.getProperty("/movementType");
            if (sRefType === "PO" && sMovementType === "I") {
                this._populateItemsFromReference("PO", sValue);
                this._loadPOReferenceData("PO", sValue, false);
            } else if (sRefType === "SI" && sMovementType === "O") {
                this._populateItemsFromReference("SI", sValue);
                this._loadSalesInvoiceReferenceData("SI", sValue, false);
            } else {
                this._loadGoodsReceiptOpenItemsForCurrentReference();
            }
            this._updatePlantColumnVisibility();
        },

        onItemsSelectionChange: function () {
            this._applyGoodsReceiptSelectionState();
        },

        onChallanQuantityChange: function () {
            this._applyGoodsReceiptSelectionState();
        },

        formatReferenceType: function (sMovementType) {
            var oI18nModel = this.getView().getModel("i18n") || this.getOwnerComponent().getModel("i18n");
            if (!oI18nModel) {
                return sMovementType === "I" ? "Purchase Order" : "Sales Invoice";
            }
            var oBundle = oI18nModel.getResourceBundle();
            return sMovementType === "I" ? oBundle.getText("purchaseOrder") : oBundle.getText("salesInvoice");
        },

        formatReferencePlaceholder: function (sMovementType) {
            return sMovementType === "O" ? this._getI18nText("enterInvoiceNumber", null, "Enter Invoice Number") : this._getI18nText("enterPONumber", null, "Enter PO Number");
        },

        formatReferenceTooltip: function (sMovementType) {
            return sMovementType === "O" ? this._getI18nText("enterInvNoTooltip", null, "Enter Inv No") : this._getI18nText("enterPONumber", null, "Enter PO Number");
        },

        formatItemQuantityLabel: function (sMovementType) {
            return sMovementType === "O" ? this._getI18nText("billedQuantity", null, "Billed Qty") : this._getI18nText("orderQuantity", null, "Order Quantity");
        },

        onAddItem: function () {
            var oModel = this.getView().getModel("pass");
            var aItems = oModel.getProperty("/items") || [];
            var sMovementType = oModel.getProperty("/movementType");
            var aPlantKeys = this._getAvailablePlantKeys();
            aItems.push({
                itemNumber: aItems.length + 1,
                materialCode: "",
                materialDescription: "",
                quantity: "",
                challanQuantity: "",
                unitOfMeasure: "",
                orderItemNumber: "",
                batch: "",
                dateOfManufacture: null,
                plant: "",
                plantOptions: sMovementType === "I" ? aPlantKeys : [],
                storageLocationOptions: []
            });
            oModel.setProperty("/items", aItems);
            this._applyGoodsReceiptEligibilityToItems();
        },

        onRemoveItem: function (oEvent) {
            var oModel = this.getView().getModel("pass");
            var aItems = oModel.getProperty("/items") || [];
            var iIndex = parseInt(oEvent.getSource().data("index"), 10) - 1;
            aItems.splice(iIndex, 1);
            aItems.forEach(function (item, idx) {
                item.itemNumber = idx + 1;
            });
            oModel.setProperty("/items", aItems);
            this._applyGoodsReceiptEligibilityToItems();
        },

        onGoodsReceiptPress: function () {
            var oModel = this.getView().getModel("pass");
            var sGateEntryID = oModel.getProperty("/gateEntry_ID");
            var sReferenceNumber = (oModel.getProperty("/referenceNumber") || "").toString().trim();
            // Refresh snapshot from live model state (captures latest batch, date, location)
            this._applyGoodsReceiptSelectionState();
            var aSelectedItems = oModel.getProperty("/selectedGRItems") || [];
            if (!sGateEntryID) {
                MessageBox.error(this._getI18nText("selectGateEntryFirst", null, "Please select a Gate Entry first"));
                return;
            }
            if (!sReferenceNumber) {
                MessageBox.error("Reference Purchase Order number is missing");
                return;
            }
            if (!aSelectedItems.length) {
                MessageToast.show(this._getI18nText("grNoSelectableItems", null, "Select at least one open item for Goods Receipt"));
                return;
            }
            var bQtyInvalid = aSelectedItems.some(function (oItem) {
                return !Number.isFinite(Number(oItem.challanQuantity)) || Number(oItem.challanQuantity) <= 0;
            });
            if (bQtyInvalid) {
                MessageBox.error(this._getI18nText("grQtyInvalidForSelected", null, "Enter Challan Quantity greater than zero for selected items"));
                return;
            }

            var oODataModel = this.getView().getModel();
            if (!oODataModel) {
                MessageBox.error(this._getI18nText("grPostFailed", null, "Goods Receipt posting failed"));
                return;
            }
            oModel.setProperty("/isGoodsReceiptBusy", true);
            this._applyGoodsReceiptSelectionState();

            var aPayloadItems = aSelectedItems.map(function (oItem) {
                return {
                    orderItemNumber: oItem.orderItemNumber,
                    challanQuantity: Number(oItem.challanQuantity),
                    storageLocation: oItem.storageLocation || null,
                    plant: oItem.plant || null,
                    batch: oItem.batch || null,
                    dateOfManufacture: this._toOptionalEdmDate(oItem.dateOfManufacture)
                };
            }.bind(this));

            var oAction = oODataModel.bindContext("/postGoodsReceipt(...)");
            oAction.setParameter("gateEntryID", sGateEntryID);
            oAction.setParameter("poNumber", sReferenceNumber);
            oAction.setParameter("itemsJson", JSON.stringify(aPayloadItems));

            oAction.execute().then(function () {
                var oResult = oAction.getBoundContext().getObject() || {};
                var sMatDoc = oResult.materialDocument || "";
                var sPostedCount = oResult.postedItems || aPayloadItems.length;
                MessageBox.success(this._getI18nText("grPostingSuccess", [sPostedCount, sMatDoc], "Goods Receipt posted successfully"));
                this._clearItemsTableSelection();
                this._populateFromGateEntry(sGateEntryID);
            }.bind(this)).catch(function (oError) {
                MessageBox.error(this._extractErrorMessage(oError));
            }.bind(this)).finally(function () {
                oModel.setProperty("/isGoodsReceiptBusy", false);
                this._applyGoodsReceiptSelectionState();
            }.bind(this));
        },

        _extractErrorMessage: function (oError, sFallbackKey, sFallbackText) {
            var sMessage = "";
            if (oError && oError.error && oError.error.message) {
                sMessage = oError.error.message;
            }
            if (!sMessage && oError && oError.cause && oError.cause.error && oError.cause.error.message) {
                sMessage = oError.cause.error.message;
            }
            if (!sMessage && oError && oError.cause && oError.cause.responseText) {
                try {
                    var oPayload = JSON.parse(oError.cause.responseText);
                    sMessage = (oPayload && oPayload.error && (oPayload.error.message?.value || oPayload.error.message)) || "";
                } catch (e) {
                    sMessage = "";
                }
            }
            if (!sMessage && oError && oError.cause && oError.cause.message) {
                sMessage = oError.cause.message;
            }
            if (!sMessage && oError && oError.message) {
                sMessage = oError.message;
            }
            if (sMessage) {
                return sMessage;
            }
            return this._getI18nText(sFallbackKey || "grPostFailed", null, sFallbackText || "Request failed");
        },

        onSavePress: function () {
            var oModel = this.getView().getModel("pass");
            var oData = oModel.getData();
            var bIsOutward = oData.movementType === "O";
            var oPassDate = this.byId("passDatePicker").getDateValue();
            var oPassTime = this.byId("passTimePicker").getDateValue();
            var oInvoiceDate = this.byId("invoiceDatePicker").getDateValue();
            var oEWayBillDate = this.byId("eWayBillDatePicker").getDateValue();

            if (!oData.gateEntry_ID) {
                MessageBox.error("Gate Entry is mandatory");
                return;
            }
            if (!oData.vehicleNumber) {
                MessageBox.error("Vehicle Number is mandatory");
                return;
            }
            if (!oPassDate) {
                MessageBox.error("Pass Date is mandatory");
                return;
            }
            if (!oInvoiceDate) {
                MessageBox.error("Invoice Date is mandatory");
                return;
            }
            if (bIsOutward && !(oData.referenceNumber || "").toString().trim()) {
                MessageBox.error("Reference Number (Invoice) is mandatory for Outward movement");
                return;
            }

            var aItems = oData.items || [];
            if (aItems.length === 0) {
                MessageBox.error("At least one material item is required");
                return;
            }

            for (var i = 0; i < aItems.length; i++) {
                if (!aItems[i].materialCode) {
                    MessageBox.error("Material Code is mandatory for all items");
                    return;
                }
                if (!aItems[i].materialDescription) {
                    MessageBox.error("Material Description is mandatory for all items");
                    return;
                }
                if (!bIsOutward && (!aItems[i].challanQuantity || Number.isNaN(parseFloat(aItems[i].challanQuantity)) || parseFloat(aItems[i].challanQuantity) <= 0)) {
                    MessageBox.error(this._getI18nText("challanQtyMandatory", null, "Challan Quantity must be greater than zero for all items"));
                    return;
                }
                if (aItems[i].quantity && Number.isNaN(parseFloat(aItems[i].quantity))) {
                    MessageBox.error("Quantity must be a valid number for all items");
                    return;
                }
                if (bIsOutward && (!aItems[i].quantity || Number.isNaN(parseFloat(aItems[i].quantity)) || parseFloat(aItems[i].quantity) < 0)) {
                    MessageBox.error(this._getI18nText("billedQtyMandatory", null, "Billed Quantity must be zero or greater for all items"));
                    return;
                }
            }

            var oODataModel = this.getView().getModel();
            var aItemPayload = aItems.map(function (item, iIndex) {
                var nParsedItemNumber = parseInt((item.itemNumber != null ? String(item.itemNumber) : ""), 10);
                var nItemNumber = Number.isFinite(nParsedItemNumber) && nParsedItemNumber > 0 ? nParsedItemNumber : (iIndex + 1);
                return {
                    itemNumber: nItemNumber,
                    materialCode: item.materialCode,
                    materialDescription: item.materialDescription,
                    quantity: item.quantity ? parseFloat(item.quantity) : 0,
                    challanQuantity: bIsOutward ? null : (parseFloat(item.challanQuantity) || 0),
                    unitOfMeasure: item.unitOfMeasure,
                    orderItemNumber: item.orderItemNumber,
                    batch: item.batch || "",
                    dateOfManufacture: this._toOptionalEdmDate(item.dateOfManufacture),
                    plant: bIsOutward ? (item.plant || "") : (item.plant || ""),
                    storageLocation: bIsOutward ? (item.storageLocation || "") : (item.storageLocation || "")
                };
            }.bind(this));

            var oAction = oODataModel.bindContext("/saveGatePassData(...)");
            oAction.setParameter("gateEntryID", oData.gateEntry_ID);
            oAction.setParameter("referenceNumber", oData.referenceNumber || null);
            oAction.setParameter("vehicleNumber", oData.vehicleNumber);
            oAction.setParameter("vehicleType", oData.vehicleType);
            oAction.setParameter("transporterName", oData.transporterName);
            oAction.setParameter("driverName", oData.driverName);
            oAction.setParameter("lrNumber", oData.lrNumber);
            oAction.setParameter("invoiceDate", this._toOptionalEdmDate(oInvoiceDate));
            oAction.setParameter("invoiceValue", oData.invoiceValue ? String(oData.invoiceValue).trim() : null);
            oAction.setParameter("eWayBillNumber", oData.eWayBillNumber);
            oAction.setParameter("eWayBillDate", this._toOptionalEdmDate(oEWayBillDate));
            oAction.setParameter("shippingAddress", oData.shippingAddress);
            oAction.setParameter("passDate", this._toEdmDate(oPassDate));
            oAction.setParameter("passTime", oPassTime ? this._toEdmTime(oPassTime) : null);
            oAction.setParameter("remarks", oData.remarks);
            oAction.setParameter("itemsJson", JSON.stringify(aItemPayload));

            oAction.execute().then(function () {
                var oResponse = oAction.getBoundContext().getObject();
                MessageBox.success("Data saved successfully for Gate Entry: " + (oResponse?.gateEntryNumber || oData.gateEntryNumber || ""));
                this._clearForm();
                this._loadOpenGateEntries();
            }.bind(this)).catch(function (oError) {
                var sMessage = this._extractErrorMessage(oError, "saveError", "Error saving data");
                MessageBox.error(sMessage);
            }.bind(this));
        },

        onCancelPress: function () {
            this._clearForm();
            MessageToast.show("Form cleared");
        },

        onPrintPress: function () {
            var oModel = this.getView().getModel("pass");
            var sGatePassID = oModel.getProperty("/gatePassID");
            if (!sGatePassID) {
                MessageBox.error("Please save the Gate Pass first");
                return;
            }
            var oODataModel = this.getView().getModel();
            var oAction = oODataModel.bindContext("/printGatePass(...)");
            oAction.setParameter("gatePassID", sGatePassID);
            oAction.execute().then(function () {
                var oResult = oAction.getBoundContext().getObject();
                MessageToast.show("Print data generated");
                console.log(oResult);
            }).catch(function () {
                MessageBox.error("Failed to generate print");
            });
        },

        onNavBack: function () {
            this.getOwnerComponent().getRouter().navTo("Dashboard");
        },

        _resolvePOPlant: function (oRow) {
            var aCandidates = oRow ? [oRow.plant, oRow.Plant] : [];
            for (var i = 0; i < aCandidates.length; i++) {
                if (aCandidates[i] !== undefined && aCandidates[i] !== null && String(aCandidates[i]).trim() !== "") {
                    return String(aCandidates[i]).trim();
                }
            }
            return "";
        },

        _resolvePOUnitOfMeasure: function (oRow) {
            var aCandidates = oRow ? [
                oRow.purchase_order_quantity_unit,
                oRow.purchaseOrderQuantityUnit,
                oRow.PurchaseOrderQuantityUnit,
                oRow.order_quantity_unit_iso_code,
                oRow.orderQuantityUnitISOCode,
                oRow.OrderQuantityUnitISOCode
            ] : [];
            for (var i = 0; i < aCandidates.length; i++) {
                if (aCandidates[i] !== undefined && aCandidates[i] !== null && String(aCandidates[i]).trim() !== "") {
                    return String(aCandidates[i]).trim();
                }
            }
            return "";
        },

        _updatePlantColumnVisibility: function () {
            var oModel = this.getView().getModel("pass");
            var sMovementType = (oModel.getProperty("/movementType") || "").toString().trim().toUpperCase();
            var sReferenceType = (oModel.getProperty("/referenceType") || "").toString().trim().toUpperCase();
            var sReferenceNumber = (oModel.getProperty("/referenceNumber") || "").toString().trim();
            var bOutward = sMovementType === "O" || sReferenceType === "SI";
            var bShowChallanColumn = !bOutward;
            var bShowPlantColumn = !bOutward && !(sReferenceType === "PO" && !!sReferenceNumber);
            var bShowStorageLocationColumn = !bOutward;
            oModel.setProperty("/showChallanColumn", bShowChallanColumn);
            oModel.setProperty("/showPlantColumn", bShowPlantColumn);
            oModel.setProperty("/showStorageLocationColumn", bShowStorageLocationColumn);
            var oPlantCol = this.byId("plantColumn");
            if (oPlantCol) {
                oPlantCol.setVisible(bShowPlantColumn);
            }
        },

        _getAvailablePlantKeys: function () {
            return [{ key: "WE01", text: "WE01" }, { key: "WE02", text: "WE02" }, { key: "WR01", text: "WR01" }, { key: "WR02", text: "WR02" }];
        },

        _loadPlantLocationData: function () {
            // Embedded plant-location master data for reliable loading in deployed env
            var oPlantData = {
                "plants": [
                    {"plnt": "WE01", "locations": [
                        {"location": "1001", "description": "Main Store"},
                        {"location": "1006", "description": "Finished Good"},
                        {"location": "FGS1", "description": "S.LOC- SOLARKIT"}
                    ]},
                    {"plnt": "WE02", "locations": [
                        {"location": "1001", "description": "Stores & Spares"},
                        {"location": "1002", "description": "Store Raw Mat"},
                        {"location": "1003", "description": "Store Transit-lo"},
                        {"location": "1004", "description": "Shop Floor -Cell"},
                        {"location": "1005", "description": "Semi-FG Cell"},
                        {"location": "1006", "description": "Finished Good-Ce"},
                        {"location": "CL01", "description": "Cell Production"},
                        {"location": "EL01", "description": "Electrical Depar"},
                        {"location": "FGL1", "description": "Factory FG Godwn"},
                        {"location": "RM01", "description": "RAW MAT GODOWN 1"},
                        {"location": "RM02", "description": "Raw mat godown 2"},
                        {"location": "SCRP", "description": "SCRAP MAT S.LOC"}
                    ]},
                    {"plnt": "WR01", "locations": [
                        {"location": "1200", "description": "PROJECT STORE"}
                    ]},
                    {"plnt": "WR02", "locations": [
                        {"location": "1210", "description": "PROJECT STORE"}
                    ]}
                ]
            };
            var mByPlant = {};
            var aPlants = Array.isArray(oPlantData.plants) ? oPlantData.plants : [];
            aPlants.forEach(function (oPlant) {
                var sPlant = (oPlant && oPlant.plnt || "").toString().trim().toUpperCase();
                if (!sPlant) {
                    return;
                }
                var aLocations = Array.isArray(oPlant.locations) ? oPlant.locations : [];
                mByPlant[sPlant] = aLocations.map(function (oLocation) {
                    var sLocation = (oLocation && oLocation.location || "").toString().trim();
                    var sDescription = (oLocation && oLocation.description || "").toString().trim();
                    return {
                        key: sLocation,
                        text: sDescription ? (sLocation + " - " + sDescription) : sLocation
                    };
                }).filter(function (oLocation) {
                    return !!oLocation.key;
                });
            });
            this._mStorageLocationsByPlant = mByPlant;
        },

        _getStorageLocationOptionsForPlant: function (sPlant) {
            var sKey = (sPlant || "").toString().trim().toUpperCase();
            var aLocations = this._mStorageLocationsByPlant[sKey] || [];
            return aLocations.map(function (oLocation) {
                return { key: oLocation.key, text: oLocation.text };
            });
        },

        onItemPlantChange: function (oEvent) {
            var sNewPlant = oEvent.getParameter("selectedItem")?.getKey() || "";
            var oCtx = oEvent.getSource().getBindingContext("pass");
            if (!oCtx) {
                return;
            }
            var sPath = oCtx.getPath();
            var iIndex = parseInt(sPath.split("/").pop(), 10);
            var oModel = this.getView().getModel("pass");
            var aItems = oModel.getProperty("/items") || [];
            if (!Number.isNaN(iIndex) && iIndex >= 0 && iIndex < aItems.length) {
                var oItem = Object.assign({}, aItems[iIndex], {
                    plant: sNewPlant,
                    storageLocationOptions: this._getStorageLocationOptionsForPlant(sNewPlant),
                    storageLocation: ""
                });
                aItems[iIndex] = oItem;
                oModel.setProperty("/items", aItems);
                this._applyGoodsReceiptSelectionState();
            }
        },

        onItemStorageLocationChange: function () {
            this._applyGoodsReceiptSelectionState();
        },

        onItemBatchChange: function () {
            this._applyGoodsReceiptSelectionState();
        },

        onItemDateOfManufactureChange: function () {
            this._applyGoodsReceiptSelectionState();
        },
    });
});
