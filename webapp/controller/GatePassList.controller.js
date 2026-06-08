sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageToast",
    "sap/m/MessageBox",
    "sap/base/Log",
    "com/mdasad/gatepass/model/POMockData"
], function (Controller, JSONModel, MessageToast, MessageBox, Log, POMockData) {
    "use strict";

    return Controller.extend("com.mdasad.gatepass.controller.GatePassList", {

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
                passTime: null,
                remarks: "",
                items: []
            });
            this.getView().setModel(oModel, "pass");
            this._mPOItemsByNumber = {};
            this._mPOHeaderByNumber = {};
            this._setPOMockData(POMockData.getAll());

            this.getOwnerComponent().getRouter().getRoute("GatePassList").attachPatternMatched(this._onRouteMatched, this);
        },

        _resolvePartyFromPO: function (sReferenceType, sReferenceNumber) {
            if (sReferenceType !== "PO" || !sReferenceNumber) {
                return null;
            }
            return this._mPOHeaderByNumber[sReferenceNumber] || null;
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

        _setPOMockData: function (aRows) {
            var mByPONumber = {};
            var mPOHeaderByNumber = {};
            (Array.isArray(aRows) ? aRows : []).forEach(function (oRow) {
                if (!oRow || !oRow.po_no) {
                    return;
                }
                if (!mByPONumber[oRow.po_no]) {
                    mByPONumber[oRow.po_no] = [];
                }
                mByPONumber[oRow.po_no].push(oRow);
                if (!mPOHeaderByNumber[oRow.po_no]) {
                    mPOHeaderByNumber[oRow.po_no] = {
                        partyNumber: oRow.vendor || "",
                        partyName: oRow.vendor_name || ""
                    };
                }
            });
            Object.keys(mByPONumber).forEach(function (sPONumber) {
                mByPONumber[sPONumber].sort(function (a, b) {
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
            });
            this._mPOItemsByNumber = mByPONumber;
            this._mPOHeaderByNumber = mPOHeaderByNumber;
        },

        _populateItemsFromReference: function (sReferenceType, sReferenceNumber) {
            var oModel = this.getView().getModel("pass");
            if (sReferenceType !== "PO" || !sReferenceNumber) {
                oModel.setProperty("/items", []);
                return;
            }
            var aRows = this._mPOItemsByNumber[sReferenceNumber] || [];
            if (!aRows.length) {
                oModel.setProperty("/items", []);
                return;
            }
            var aItems = aRows.map(function (oRow, iIndex) {
                return {
                    itemNumber: iIndex + 1,
                    materialCode: oRow.material_no || "",
                    materialDescription: oRow.material_description || "",
                    quantity: oRow.po_qty !== undefined && oRow.po_qty !== null ? String(oRow.po_qty) : "",
                    unitOfMeasure: "",
                    supplierInvoiceNo: "",
                    supplierInvoiceDate: null,
                    orderItemNumber: oRow.item_no !== undefined && oRow.item_no !== null ? String(oRow.item_no) : ""
                };
            });
            oModel.setProperty("/items", aItems);
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
            oModel.setProperty("/passTime", null);
            oModel.setProperty("/remarks", "");
            oModel.setProperty("/items", []);
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
                $filter: "entryStatus eq 'CREATED'"
            });
            return oListBinding.requestContexts(0, 500).then(function (aContexts) {
                var aOpenEntries = aContexts.map(function (oContext) {
                    return oContext.getObject();
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
                MessageToast.show("Could not fetch Gate Entry details");
            });
        },

        _applyGateEntryToPassModel: function (oData) {
            var oModel = this.getView().getModel("pass");
            oModel.setProperty("/gateEntry_ID", oData.ID);
            oModel.setProperty("/gateEntryNumber", oData.gateEntryNumber);
            oModel.setProperty("/movementType", oData.movementType);
            oModel.setProperty("/referenceType", oData.referenceType);
            oModel.setProperty("/referenceNumber", oData.referenceNumber);
            var oPOParty = this._resolvePartyFromPO(oData.referenceType, oData.referenceNumber);
            oModel.setProperty("/partyNumber", oPOParty ? oPOParty.partyNumber : oData.partyNumber);
            oModel.setProperty("/partyName", oPOParty ? oPOParty.partyName : oData.partyName);
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
            oModel.setProperty("/passTime", this._fromEdmTime(oData.passTime));
            oModel.setProperty("/remarks", oData.passRemarks || "");

            if (oData.materialItemsJson) {
                try {
                    var aSavedItems = JSON.parse(oData.materialItemsJson);
                    oModel.setProperty("/items", Array.isArray(aSavedItems) ? aSavedItems : []);
                    return;
                } catch (e) {
                    // fall back to reference-based population below
                }
            }
            this._populateItemsFromReference(oData.referenceType, oData.referenceNumber);
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
            this._populateFromGateEntry(sSelectedKey);
        },

        formatReferenceType: function (sMovementType) {
            var oI18nModel = this.getView().getModel("i18n") || this.getOwnerComponent().getModel("i18n");
            if (!oI18nModel) {
                return sMovementType === "I" ? "Purchase Order" : "Sales Invoice";
            }
            var oBundle = oI18nModel.getResourceBundle();
            return sMovementType === "I" ? oBundle.getText("purchaseOrder") : oBundle.getText("salesInvoice");
        },

        onAddItem: function () {
            var oModel = this.getView().getModel("pass");
            var aItems = oModel.getProperty("/items") || [];
            aItems.push({
                itemNumber: aItems.length + 1,
                materialCode: "",
                materialDescription: "",
                quantity: "",
                unitOfMeasure: "",
                supplierInvoiceNo: "",
                supplierInvoiceDate: null,
                orderItemNumber: ""
            });
            oModel.setProperty("/items", aItems);
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
        },

        onSavePress: function () {
            var oModel = this.getView().getModel("pass");
            var oData = oModel.getData();
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
                if (!aItems[i].quantity) {
                    MessageBox.error("Quantity is mandatory for all items");
                    return;
                }
                if (Number.isNaN(parseFloat(aItems[i].quantity))) {
                    MessageBox.error("Quantity must be a valid number for all items");
                    return;
                }
            }

            var oODataModel = this.getView().getModel();
            var aItemPayload = aItems.map(function (item) {
                return {
                    itemNumber: item.itemNumber,
                    materialCode: item.materialCode,
                    materialDescription: item.materialDescription,
                    quantity: parseFloat(item.quantity),
                    unitOfMeasure: item.unitOfMeasure,
                    supplierInvoiceNo: item.supplierInvoiceNo,
                    supplierInvoiceDate: this._toOptionalEdmDate(item.supplierInvoiceDate),
                    orderItemNumber: item.orderItemNumber
                };
            }.bind(this));

            var oAction = oODataModel.bindContext("/saveGatePassData(...)");
            oAction.setParameter("gateEntryID", oData.gateEntry_ID);
            oAction.setParameter("vehicleNumber", oData.vehicleNumber);
            oAction.setParameter("vehicleType", oData.vehicleType);
            oAction.setParameter("transporterName", oData.transporterName);
            oAction.setParameter("driverName", oData.driverName);
            oAction.setParameter("lrNumber", oData.lrNumber);
            oAction.setParameter("invoiceDate", this._toOptionalEdmDate(oInvoiceDate));
            oAction.setParameter("invoiceValue", oData.invoiceValue ? parseFloat(oData.invoiceValue) : null);
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
                var sMessage = oError.message || "Error saving data";
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
        }
    });
});
