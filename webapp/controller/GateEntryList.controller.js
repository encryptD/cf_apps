sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageToast",
    "sap/m/MessageBox",
    "com/mdasad/gatepass/model/POMockData"
], function (Controller, JSONModel, MessageToast, MessageBox, POMockData) {
    "use strict";

    return Controller.extend("com.mdasad.gatepass.controller.GateEntryList", {


        onInit: function () {
            var oModel = new JSONModel({
                modeKey: "create",
                mode: "Create",
                selectedGateEntryId: "",
                gateEntries: [],
                entryStatus: "",
                isFormEditable: true,
                showStatusHeader: false,
                movementType: "I",
                referenceType: "PO",
                referenceNumber: "",
                plant: "",
                partyNumber: "",
                partyName: "",
                vehicleNumber: "",
                vehicleType: "",
                transporterNumber: "",
                transporterName: "",
                driverName: "",
                driverContact: "",
                lrNumber: "",
                gateEntryNumber: "",
                gateEntryYear: new Date().getFullYear(),
                entryDate: new Date(),
                entryTime: null,
                remarks: "",
                poNo: ""
            });
            this.getView().setModel(oModel, "entry");
            this._mGateEntryContexts = {};

            // Load PO mock data
            this._loadPOMockData();

            // OData model will be set from manifest
            this.getOwnerComponent().getRouter().getRoute("GateEntryList").attachPatternMatched(this._onRouteMatched, this);
        },

        _loadPOMockData: function () {
            var aData = POMockData.getAll();
            var aUniquePOs = [];
            var mPOs = {};
            aData.forEach(function (oItem) {
                if (!mPOs[oItem.po_no]) {
                    mPOs[oItem.po_no] = true;
                    aUniquePOs.push({
                        poNo: oItem.po_no,
                        poNoText: oItem.po_no
                    });
                }
            });
            this.getView().setModel(new JSONModel({
                poData: aData,
                poList: aUniquePOs
            }), "po");
        },

        _onRouteMatched: function () {
            this._clearForm();
            this._applyModeState("create");
            this._loadCreatedGateEntries();
        },

        _clearForm: function () {
            var oModel = this.getView().getModel("entry");
            oModel.setProperty("/modeKey", "create");
            oModel.setProperty("/mode", "Create");
            oModel.setProperty("/selectedGateEntryId", "");
            oModel.setProperty("/entryStatus", "");
            oModel.setProperty("/movementType", "I");
            oModel.setProperty("/referenceType", "PO");
            oModel.setProperty("/referenceNumber", "");
            oModel.setProperty("/plant", "");
            oModel.setProperty("/partyNumber", "");
            oModel.setProperty("/partyName", "");
            oModel.setProperty("/vehicleNumber", "");
            oModel.setProperty("/vehicleType", "");
            oModel.setProperty("/transporterNumber", "");
            oModel.setProperty("/transporterName", "");
            oModel.setProperty("/driverName", "");
            oModel.setProperty("/driverContact", "");
            oModel.setProperty("/lrNumber", "");
            oModel.setProperty("/gateEntryNumber", "");
            oModel.setProperty("/gateEntryYear", new Date().getFullYear());
            oModel.setProperty("/entryDate", new Date());
            oModel.setProperty("/entryTime", null);
            oModel.setProperty("/remarks", "");
            oModel.setProperty("/poNo", "");
        },

        _applyModeState: function (sModeKey) {
            var oModel = this.getView().getModel("entry");
            var mModeTitle = {
                create: "Create",
                change: "Change",
                display: "Display",
                cancel: "Cancel"
            };
            oModel.setProperty("/modeKey", sModeKey);
            oModel.setProperty("/mode", mModeTitle[sModeKey] || "Create");
            oModel.setProperty("/isFormEditable", sModeKey === "create" || sModeKey === "change");
            oModel.setProperty("/showStatusHeader", sModeKey === "display");
        },

        onModeChange: function (oEvent) {
            var sModeKey = oEvent.getParameter("item").getKey();
            this._applyModeState(sModeKey);
            if (sModeKey === "create") {
                this._clearForm();
                this._applyModeState("create");
                return;
            }
            this.getView().getModel("entry").setProperty("/selectedGateEntryId", "");
            this._clearEntryFields();
            this._loadCreatedGateEntries();
        },

        _clearEntryFields: function () {
            var oModel = this.getView().getModel("entry");
            oModel.setProperty("/entryStatus", "");
            oModel.setProperty("/movementType", "I");
            oModel.setProperty("/referenceType", "PO");
            oModel.setProperty("/referenceNumber", "");
            oModel.setProperty("/plant", "");
            oModel.setProperty("/partyNumber", "");
            oModel.setProperty("/partyName", "");
            oModel.setProperty("/vehicleNumber", "");
            oModel.setProperty("/vehicleType", "");
            oModel.setProperty("/transporterNumber", "");
            oModel.setProperty("/transporterName", "");
            oModel.setProperty("/driverName", "");
            oModel.setProperty("/driverContact", "");
            oModel.setProperty("/lrNumber", "");
            oModel.setProperty("/gateEntryNumber", "");
            oModel.setProperty("/gateEntryYear", new Date().getFullYear());
            oModel.setProperty("/entryDate", new Date());
            oModel.setProperty("/entryTime", null);
            oModel.setProperty("/remarks", "");
            oModel.setProperty("/poNo", "");
        },

        _loadCreatedGateEntries: function () {
            var oODataModel = this.getView().getModel();
            if (!oODataModel) {
                return Promise.resolve();
            }
            var oListBinding = oODataModel.bindList("/GateEntries", null, null, null, {
                $filter: "entryStatus eq 'CREATED'"
            });
            return oListBinding.requestContexts(0, 500).then(function (aContexts) {
                var aEntries = [];
                this._mGateEntryContexts = {};
                aContexts.forEach(function (oContext) {
                    var oObject = oContext.getObject();
                    if (oObject && oObject.ID) {
                        this._mGateEntryContexts[oObject.ID] = oContext;
                        aEntries.push(oObject);
                    }
                }.bind(this));
                this.getView().getModel("entry").setProperty("/gateEntries", aEntries);
            }.bind(this)).catch(function () {
                MessageToast.show("Could not load Gate Entries");
            });
        },

        onGateEntrySelect: function (oEvent) {
            var oSource = oEvent.getSource ? oEvent.getSource() : null;
            var sSelectedId = oEvent.getParameter("selectedItem")?.getKey() || (oSource && oSource.getSelectedKey ? oSource.getSelectedKey() : "");
            if (!sSelectedId) {
                return;
            }
            this.getView().getModel("entry").setProperty("/selectedGateEntryId", sSelectedId);
            var oContext = this._mGateEntryContexts[sSelectedId];
            if (!oContext) {
                MessageBox.error("Selected Gate Entry could not be loaded");
                return;
            }
            var oData = oContext.getObject();
            var oModel = this.getView().getModel("entry");
            oModel.setProperty("/entryStatus", oData.entryStatus || "");
            oModel.setProperty("/movementType", oData.movementType || "I");
            oModel.setProperty("/referenceType", oData.referenceType || (oData.movementType === "I" ? "PO" : "SI"));
            oModel.setProperty("/referenceNumber", oData.referenceNumber || "");
            oModel.setProperty("/plant", oData.plant || "");
            oModel.setProperty("/partyNumber", oData.partyNumber || "");
            oModel.setProperty("/partyName", oData.partyName || "");
            oModel.setProperty("/vehicleNumber", oData.vehicleNumber || "");
            oModel.setProperty("/vehicleType", oData.vehicleType || "");
            oModel.setProperty("/transporterNumber", oData.transporterNumber || "");
            oModel.setProperty("/transporterName", oData.transporterName || "");
            oModel.setProperty("/driverName", oData.driverName || "");
            oModel.setProperty("/driverContact", oData.driverContact || "");
            oModel.setProperty("/lrNumber", oData.lrNumber || "");
            oModel.setProperty("/gateEntryNumber", oData.gateEntryNumber || "");
            oModel.setProperty("/gateEntryYear", oData.gateEntryYear || new Date().getFullYear());
            oModel.setProperty("/entryDate", oData.entryDate ? new Date(oData.entryDate) : null);
            oModel.setProperty("/entryTime", this._fromEdmTime(oData.entryTime));
            oModel.setProperty("/remarks", oData.remarks || "");
            oModel.setProperty("/poNo", oData.referenceNumber || "");
        },

        _fromEdmTime: function (vValue) {
            if (!vValue) {
                return null;
            }
            if (vValue instanceof Date && !Number.isNaN(vValue.getTime())) {
                return vValue;
            }
            if (typeof vValue === "string") {
                var aParts = vValue.split(":");
                if (aParts.length >= 2) {
                    var oDate = new Date();
                    oDate.setHours(parseInt(aParts[0], 10), parseInt(aParts[1], 10), parseInt(aParts[2] || "0", 10), 0);
                    return oDate;
                }
            }
            return null;
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

        formatReferenceType: function (sMovementType) {
            var oI18nModel = this.getView().getModel("i18n") || this.getOwnerComponent().getModel("i18n");
            if (!oI18nModel) {
                return sMovementType === "I" ? "Purchase Order" : "Sales Invoice";
            }
            var oBundle = oI18nModel.getResourceBundle();
            return sMovementType === "I" ? oBundle.getText("purchaseOrder") : oBundle.getText("salesInvoice");
        },

        formatPlaceholder: function (sMovementType) {
            var oI18nModel = this.getView().getModel("i18n") || this.getOwnerComponent().getModel("i18n");
            if (!oI18nModel) {
                return sMovementType === "I" ? "Enter PO Number" : "Enter Invoice Number";
            }
            var oBundle = oI18nModel.getResourceBundle();
            return sMovementType === "I" ? oBundle.getText("enterPONumber") : oBundle.getText("enterInvoiceNumber");
        },

        onMovementTypeChange: function (oEvent) {
            var oModel = this.getView().getModel("entry");
            var sMovement = oEvent.getParameter("selectedIndex") === 0 ? "I" : "O";
            oModel.setProperty("/movementType", sMovement);
            oModel.setProperty("/referenceType", sMovement === "I" ? "PO" : "SI");
        },

        onPONoChange: function (oEvent) {
            var oSource = oEvent.getSource ? oEvent.getSource() : null;
            var sSelectedPO = oEvent.getParameter("selectedItem")?.getKey() || (oSource && oSource.getSelectedKey ? oSource.getSelectedKey() : "");
            var oEntryModel = this.getView().getModel("entry");
            var oPOModel = this.getView().getModel("po");

            // Reset dependent fields
            oEntryModel.setProperty("/plant", "");
            oEntryModel.setProperty("/partyNumber", "");
            oEntryModel.setProperty("/partyName", "");
            oEntryModel.setProperty("/referenceNumber", "");

            if (!sSelectedPO || !oPOModel) {
                return;
            }

            oEntryModel.setProperty("/poNo", sSelectedPO);
            oEntryModel.setProperty("/referenceNumber", sSelectedPO);

            // Find first matching record for selected PO and auto-populate fields
            var aPOData = oPOModel.getProperty("/poData") || [];
            var oMatch = aPOData.find(function (oItem) {
                return oItem.po_no === sSelectedPO;
            });

            if (oMatch) {
                oEntryModel.setProperty("/plant", oMatch.plant || "");
                oEntryModel.setProperty("/partyNumber", oMatch.vendor || "");
                oEntryModel.setProperty("/partyName", oMatch.vendor_name || "");
            }
        },

        onSavePress: function () {
            var oModel = this.getView().getModel("entry");
            var oData = oModel.getData();
            var sModeKey = oData.modeKey || "create";
            if (sModeKey === "display") {
                return;
            }
            if (sModeKey === "cancel") {
                this._cancelSelectedEntry();
                return;
            }
            var oEntryDate = this.byId("entryDatePicker").getDateValue();
            var oEntryTime = this.byId("entryTimePicker").getDateValue();

            // Mandatory validations
            if (!oData.vehicleNumber) {
                MessageBox.error("Vehicle Number is mandatory");
                return;
            }
            if (!oData.vehicleType) {
                MessageBox.error("Vehicle Type is mandatory");
                return;
            }
            if (!oData.driverName) {
                MessageBox.error("Driver Name is mandatory");
                return;
            }
            if (!oData.transporterName) {
                MessageBox.error("Transporter Name is mandatory");
                return;
            }
            if (!oEntryDate) {
                MessageBox.error("Entry Date is mandatory");
                return;
            }

            var oODataModel = this.getView().getModel();
            var oPayload = {
                movementType: oData.movementType,
                referenceType: oData.referenceType,
                referenceNumber: oData.referenceNumber,
                plant: oData.plant,
                partyNumber: oData.partyNumber,
                partyName: oData.partyName,
                vehicleNumber: oData.vehicleNumber,
                vehicleType: oData.vehicleType,
                transporterNumber: oData.transporterNumber,
                transporterName: oData.transporterName,
                driverName: oData.driverName,
                driverContact: oData.driverContact,
                lrNumber: oData.lrNumber,
                entryDate: this._toEdmDate(oEntryDate),
                entryTime: oEntryTime ? this._toEdmTime(oEntryTime) : null,
                remarks: oData.remarks
            };
            if (sModeKey === "change") {
                this._updateSelectedEntry(oPayload);
                return;
            }

            var oListBinding = oODataModel.bindList("/GateEntries");
            var oContext = oListBinding.create(oPayload);

            oContext.created().then(function () {
                return oContext.requestObject();
            }.bind(this)).then(function (oResponse) {
                MessageBox.success("Gate Entry created: " + oResponse.gateEntryNumber, {
                    actions: ["Open Gate Pass", MessageBox.Action.OK],
                    emphasizedAction: "Open Gate Pass",
                    onClose: function (sAction) {
                        if (sAction === "Open Gate Pass" && oResponse && oResponse.ID) {
                            this.getOwnerComponent().getRouter().navTo("GatePassList", {
                                query: {
                                    gateEntryId: oResponse.ID,
                                    gateEntryNumber: oResponse.gateEntryNumber || ""
                                }
                            });
                        }
                    }.bind(this)
                });
                this._clearForm();
            }.bind(this)).catch(function (oError) {
                var sMessage = oError.message || "Error creating Gate Entry";
                MessageBox.error(sMessage);
            }.bind(this));
        },

        _updateSelectedEntry: function (oPayload) {
            var oModel = this.getView().getModel("entry");
            var sSelectedId = oModel.getProperty("/selectedGateEntryId");
            if (!sSelectedId) {
                MessageBox.error("Please select a Gate Entry first");
                return;
            }
            var oContext = this._mGateEntryContexts[sSelectedId];
            if (!oContext) {
                MessageBox.error("Selected Gate Entry is not available for update");
                return;
            }
            Object.keys(oPayload).forEach(function (sKey) {
                oContext.setProperty(sKey, oPayload[sKey]);
            });
            this.getView().getModel().submitBatch("$auto").then(function () {
                MessageBox.success("Gate Entry updated: " + (oModel.getProperty("/gateEntryNumber") || ""));
                this._loadCreatedGateEntries();
            }.bind(this)).catch(function (oError) {
                MessageBox.error(oError.message || "Error updating Gate Entry");
            });
        },

        _cancelSelectedEntry: function () {
            var oModel = this.getView().getModel("entry");
            var sSelectedId = oModel.getProperty("/selectedGateEntryId");
            if (!sSelectedId) {
                MessageBox.error("Please select a Gate Entry first");
                return;
            }
            var oContext = this._mGateEntryContexts[sSelectedId];
            if (!oContext) {
                MessageBox.error("Selected Gate Entry is not available for cancel");
                return;
            }
            oContext.setProperty("entryStatus", "CANCELLED");
            this.getView().getModel().submitBatch("$auto").then(function () {
                MessageBox.success("Gate Entry cancelled successfully");
                this._clearForm();
                this._applyModeState("cancel");
                this._loadCreatedGateEntries();
            }.bind(this)).catch(function (oError) {
                MessageBox.error(oError.message || "Error cancelling Gate Entry");
            });
        },

        onCancelPress: function () {
            var sModeKey = this.getView().getModel("entry").getProperty("/modeKey");
            if (sModeKey === "create") {
                this._clearForm();
            } else {
                this.getView().getModel("entry").setProperty("/selectedGateEntryId", "");
                this._clearEntryFields();
                this._applyModeState(sModeKey);
            }
            MessageToast.show("Form cleared");
        },

        onNavBack: function () {
            this.getOwnerComponent().getRouter().navTo("Dashboard");
        }
    });
});