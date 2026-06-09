sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageToast",
    "sap/m/MessageBox"
], function (Controller, JSONModel, MessageToast, MessageBox) {
    "use strict";

    return Controller.extend("com.mdasad.gatepass.controller.GateExit", {

        _getCurrentTimeDate: function () {
            return new Date();
        },

        _fromEdmDate: function (vValue) {
            if (!vValue) {
                return null;
            }
            if (vValue instanceof Date && !Number.isNaN(vValue.getTime())) {
                return vValue;
            }
            if (typeof vValue === "string") {
                var oDate = new Date(vValue);
                if (!Number.isNaN(oDate.getTime())) {
                    return oDate;
                }
            }
            return null;
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

        _parseItemsJson: function (sItemsJson) {
            if (!sItemsJson) {
                return [];
            }
            try {
                var aItems = JSON.parse(sItemsJson);
                return Array.isArray(aItems) ? aItems : [];
            } catch (e) {
                return [];
            }
        },

        onInit: function () {
            var oModel = new JSONModel({
                movementType: "I",
                gateEntry_ID: "",
                gateEntryNumber: "",
                gatePass_ID: "",
                gatePassNumber: "",
                exitDate: new Date(),
                exitTime: this._getCurrentTimeDate(),
                securityOfficer: "",
                remarks: "",
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
                passDate: null,
                passTime: null,
                passRemarks: "",
                items: []
            });
            this.getView().setModel(oModel, "exit");

            this.getOwnerComponent().getRouter().getRoute("GateExit").attachPatternMatched(this._onRouteMatched, this);
        },

        _onRouteMatched: function () {
            this._clearForm();
            this._loadPassIssuedEntries();
        },

        _clearForm: function () {
            var oModel = this.getView().getModel("exit");
            oModel.setProperty("/movementType", "I");
            oModel.setProperty("/gateEntry_ID", "");
            oModel.setProperty("/gateEntryNumber", "");
            oModel.setProperty("/gatePass_ID", "");
            oModel.setProperty("/gatePassNumber", "");
            oModel.setProperty("/exitDate", new Date());
            oModel.setProperty("/exitTime", this._getCurrentTimeDate());
            oModel.setProperty("/securityOfficer", "");
            oModel.setProperty("/remarks", "");
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
            oModel.setProperty("/passDate", null);
            oModel.setProperty("/passTime", null);
            oModel.setProperty("/passRemarks", "");
            oModel.setProperty("/items", []);
            oModel.setProperty("/gatePasses", []);
        },


        _loadPassIssuedEntries: function () {
            var oODataModel = this.getView().getModel();
            if (!oODataModel) {
                return;
            }
            var oModel = this.getView().getModel("exit");
            if (typeof oODataModel.refresh === "function") {
                oODataModel.refresh();
            }
            var oListBinding = oODataModel.bindList("/GateEntries", null, null, null, {
                $filter: "entryStatus eq 'CREATED'"
            });
            oListBinding.requestContexts(0, 500).then(function (aContexts) {
                var aPassIssuedEntries = aContexts.map(function (oContext) {
                    return oContext.getObject();
                });
                oModel.setProperty("/passIssuedEntries", aPassIssuedEntries);
            }.bind(this)).catch(function () {
                oModel.setProperty("/passIssuedEntries", []);
                MessageToast.show("Could not load Gate Entries");
            });
        },

        _applyGateEntrySnapshot: function (oEntry) {
            var oModel = this.getView().getModel("exit");
            oModel.setProperty("/movementType", oEntry.movementType || "I");
            oModel.setProperty("/referenceType", oEntry.referenceType || "");
            oModel.setProperty("/referenceNumber", oEntry.referenceNumber || "");
            oModel.setProperty("/partyNumber", oEntry.partyNumber || "");
            oModel.setProperty("/partyName", oEntry.partyName || "");
            oModel.setProperty("/invoiceDate", this._fromEdmDate(oEntry.invoiceDate));
            oModel.setProperty("/invoiceValue", oEntry.invoiceValue != null ? String(oEntry.invoiceValue) : "");
            oModel.setProperty("/eWayBillNumber", oEntry.eWayBillNumber || "");
            oModel.setProperty("/eWayBillDate", this._fromEdmDate(oEntry.eWayBillDate));
            oModel.setProperty("/shippingAddress", oEntry.shippingAddress || "");
            oModel.setProperty("/vehicleNumber", oEntry.vehicleNumber || "");
            oModel.setProperty("/vehicleType", oEntry.vehicleType || "");
            oModel.setProperty("/transporterName", oEntry.transporterName || "");
            oModel.setProperty("/driverName", oEntry.driverName || "");
            oModel.setProperty("/lrNumber", oEntry.lrNumber || "");
            oModel.setProperty("/passDate", this._fromEdmDate(oEntry.passDate));
            oModel.setProperty("/passTime", this._fromEdmTime(oEntry.passTime));
            oModel.setProperty("/passRemarks", oEntry.passRemarks || "");
            oModel.setProperty("/items", this._parseItemsJson(oEntry.materialItemsJson));
        },

        _loadGatePassesForEntry: function (sGateEntryID, sGateEntryNumber) {
            var oODataModel = this.getView().getModel();
            if (!oODataModel || !sGateEntryID) {
                return;
            }
            var oModel = this.getView().getModel("exit");
            oModel.setProperty("/gatePasses", []);
            oModel.setProperty("/gatePass_ID", "");
            oModel.setProperty("/gatePassNumber", "");
            var fnLoadFallbackGatePasses = function () {
                var oFallbackListBinding = oODataModel.bindList("/GatePasses", null, null, null, {
                    $select: "ID,gatePassNumber,gateEntry_ID,gateEntryNumber,vehicleNumber,partyName"
                });
                oFallbackListBinding.requestContexts(0, 1000).then(function (aFallbackContexts) {
                    var sEntryIdNormalized = String(sGateEntryID || "").toLowerCase();
                    var sEntryNumberNormalized = String(sGateEntryNumber || "").toLowerCase();
                    var aFallbackGatePasses = aFallbackContexts.map(function (oContext) {
                        return oContext.getObject();
                    }).filter(function (oPass) {
                        var sPassEntryId = String(oPass.gateEntry_ID || oPass.gateEntryId || "").toLowerCase();
                        var sPassEntryNumber = String(oPass.gateEntryNumber || "").toLowerCase();
                        return (sPassEntryId && sPassEntryId === sEntryIdNormalized) ||
                            (sEntryNumberNormalized && sPassEntryNumber === sEntryNumberNormalized);
                    });
                    oModel.setProperty("/gatePasses", aFallbackGatePasses);
                }).catch(function () {
                    MessageToast.show("Could not load Gate Passes");
                });
            };
            if (typeof oODataModel.refresh === "function") {
                oODataModel.refresh();
            }
            fnLoadFallbackGatePasses();
        },

        onGateEntryChange: function (oEvent) {
            var oSource = oEvent.getSource ? oEvent.getSource() : null;
            var sSelectedKey = oEvent.getParameter("selectedItem")?.getKey() || (oSource && oSource.getSelectedKey ? oSource.getSelectedKey() : "");
            var oModel = this.getView().getModel("exit");
            var aEntries = oModel.getProperty("/passIssuedEntries") || [];
            if (!sSelectedKey && oSource && oSource.getValue) {
                var sInputValue = String(oSource.getValue() || "");
                var oMatchedEntry = aEntries.find(function (oEntry) {
                    var sLabel = [
                        oEntry.gateEntryNumber || "",
                        oEntry.vehicleNumber || "",
                        oEntry.partyName || ""
                    ].join(" - ");
                    return sLabel === sInputValue || (oEntry.gateEntryNumber || "") === sInputValue;
                });
                sSelectedKey = oMatchedEntry && oMatchedEntry.ID;
            }
            if (!sSelectedKey) {
                return;
            }
            var oSelectedEntry = aEntries.find(function (oEntry) {
                return oEntry && oEntry.ID === sSelectedKey;
            });
            var sGateEntryNumber = (oSelectedEntry && oSelectedEntry.gateEntryNumber) || "";

            oModel.setProperty("/gateEntry_ID", sSelectedKey);
            oModel.setProperty("/gateEntryNumber", sGateEntryNumber);
            if (oSelectedEntry) {
                this._applyGateEntrySnapshot(oSelectedEntry);
            }
            this._loadGatePassesForEntry(sSelectedKey, sGateEntryNumber);
        },

        onGatePassChange: function (oEvent) {
            var oSource = oEvent.getSource ? oEvent.getSource() : null;
            var oSelectedItem = oEvent.getParameter("selectedItem");
            var sSelectedKey = oSelectedItem?.getKey() || (oSource && oSource.getSelectedKey ? oSource.getSelectedKey() : "");
            if (!sSelectedKey) {
                return;
            }
            var oModel = this.getView().getModel("exit");
            oModel.setProperty("/gatePass_ID", sSelectedKey);
            oModel.setProperty("/gatePassNumber", oSelectedItem?.getText() || (oSource && oSource.getValue ? oSource.getValue() : ""));
        },

        formatReferenceType: function (sMovementType) {
            var oI18nModel = this.getView().getModel("i18n") || this.getOwnerComponent().getModel("i18n");
            if (!oI18nModel) {
                return sMovementType === "I" ? "Purchase Order" : "Sales Invoice";
            }
            var oBundle = oI18nModel.getResourceBundle();
            return sMovementType === "I" ? oBundle.getText("purchaseOrder") : oBundle.getText("salesInvoice");
        },

        onClosePress: function () {
            var oModel = this.getView().getModel("exit");
            var oData = oModel.getData();

            if (!oData.gateEntry_ID) {
                MessageBox.error("Gate Entry is mandatory");
                return;
            }

            var oODataModel = this.getView().getModel();
            var oAction = oODataModel.bindContext("/closeGateEntry(...)");
            oAction.setParameter("gateEntryID", oData.gateEntry_ID);
            if (oData.gatePass_ID) {
                oAction.setParameter("gatePassID", oData.gatePass_ID);
            }
            oAction.execute().then(function () {
                var oResponse = oAction.getBoundContext().getObject();
                MessageBox.success("Gate Entry closed successfully: " + (oResponse && oResponse.gateEntryNumber));
                this._clearForm();
                this._loadPassIssuedEntries();
            }.bind(this)).catch(function (oError) {
                var sMessage = oError.message || "Error closing Gate Entry";
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
