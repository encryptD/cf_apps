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
                mode: "Create",
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
        },

        _clearForm: function () {
            var oModel = this.getView().getModel("entry");
            oModel.setProperty("/mode", "Create");
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

        onCancelPress: function () {
            this._clearForm();
            MessageToast.show("Form cleared");
        },

        onNavBack: function () {
            this.getOwnerComponent().getRouter().navTo("Dashboard");
        }
    });
});