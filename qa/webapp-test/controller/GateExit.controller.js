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

        _ensureExitDateTimeEditable: function () {
            var oDatePicker = this.byId("exitDatePicker");
            if (oDatePicker) {
                oDatePicker.setEnabled(true);
                oDatePicker.setEditable(true);
            }
            var oTimePicker = this.byId("exitTimePicker");
            if (oTimePicker) {
                oTimePicker.setEnabled(true);
                oTimePicker.setEditable(true);
            }
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

        _toEdmDate: function (vValue) {
            if (!vValue) {
                return null;
            }
            if (vValue instanceof Date && !Number.isNaN(vValue.getTime())) {
                return [
                    String(vValue.getFullYear()),
                    String(vValue.getMonth() + 1).padStart(2, "0"),
                    String(vValue.getDate()).padStart(2, "0")
                ].join("-");
            }
            if (typeof vValue === "string") {
                var sDate = vValue.trim();
                if (/^\d{4}-\d{2}-\d{2}$/.test(sDate)) {
                    return sDate;
                }
                var oDate = new Date(sDate);
                if (!Number.isNaN(oDate.getTime())) {
                    return [
                        String(oDate.getFullYear()),
                        String(oDate.getMonth() + 1).padStart(2, "0"),
                        String(oDate.getDate()).padStart(2, "0")
                    ].join("-");
                }
            }
            return null;
        },

        _toEdmTime: function (vValue) {
            if (!vValue) {
                return null;
            }
            if (vValue instanceof Date && !Number.isNaN(vValue.getTime())) {
                return [
                    String(vValue.getHours()).padStart(2, "0"),
                    String(vValue.getMinutes()).padStart(2, "0"),
                    String(vValue.getSeconds()).padStart(2, "0")
                ].join(":");
            }
            if (typeof vValue === "string") {
                var sTime = vValue.trim();
                var aMatch = sTime.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
                if (aMatch) {
                    var iHours = parseInt(aMatch[1], 10);
                    var iMinutes = parseInt(aMatch[2], 10);
                    var iSeconds = parseInt(aMatch[3] || "0", 10);
                    if (iHours >= 0 && iHours < 24 && iMinutes >= 0 && iMinutes < 60 && iSeconds >= 0 && iSeconds < 60) {
                        return [
                            String(iHours).padStart(2, "0"),
                            String(iMinutes).padStart(2, "0"),
                            String(iSeconds).padStart(2, "0")
                        ].join(":");
                    }
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
                var vParsed = JSON.parse(sItemsJson);
                var aItems = Array.isArray(vParsed) ? vParsed : (Array.isArray(vParsed && vParsed.items) ? vParsed.items : []);
                return this._normalizeItems(aItems);
            } catch (e) {
                return [];
            }
        },

        _normalizeItems: function (aItems) {
            if (!Array.isArray(aItems)) {
                return [];
            }
            return aItems.map(function (oItem, iIndex) {
                var oRow = oItem || {};
                var vItemNumber = oRow.itemNumber != null ? oRow.itemNumber : (oRow.item_no != null ? oRow.item_no : (oRow.itemNo != null ? oRow.itemNo : iIndex + 1));
                var vQuantity = oRow.quantity != null ? oRow.quantity : (oRow.order_qty != null ? oRow.order_qty : (oRow.challan_qty != null ? oRow.challan_qty : (oRow.po_qty != null ? oRow.po_qty : "")));
                return {
                    itemNumber: vItemNumber,
                    materialCode: oRow.materialCode || oRow.material_no || "",
                    materialDescription: oRow.materialDescription || oRow.material_description || "",
                    quantity: vQuantity,
                    challanQuantity: oRow.challanQuantity != null ? oRow.challanQuantity : (oRow.challan_qty != null ? oRow.challan_qty : ""),
                    unitOfMeasure: oRow.unitOfMeasure || oRow.unit || oRow.uom || "",
                    orderItemNumber: oRow.orderItemNumber || oRow.order_item || "",
                    plant: oRow.plant || "",
                    storageLocation: oRow.storageLocation || "",
                    batch: oRow.batch || "",
                    dateOfManufacture: oRow.dateOfManufacture != null ? String(oRow.dateOfManufacture) : ""
                };
            });
        },

        onInit: function () {
            var oModel = new JSONModel({
                movementType: "I",
                gateEntry_ID: "",
                gateEntryNumber: "",
                passIssuedEntries: [],
                gatePass_ID: "",
                gatePassNumber: "",
                gatePasses: [],
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
            this._mGatePassById = {};
            this._iGatePassLoadSeq = 0;

            this.getOwnerComponent().getRouter().getRoute("GateExit").attachPatternMatched(this._onRouteMatched, this);
        },

        _onRouteMatched: function () {
            this._clearForm();
            this._loadPassIssuedEntries();
            this._ensureExitDateTimeEditable();
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
            this._mGatePassById = {};
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
            $filter: "(entryStatus eq 'CREATED' or entryStatus eq 'PASS_ISSUED' or entryStatus eq 'PARKED') and documentStatus ne 'CLOSED'"
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
            this._iGatePassLoadSeq = (this._iGatePassLoadSeq || 0) + 1;
            var iRequestSeq = this._iGatePassLoadSeq;
            var oModel = this.getView().getModel("exit");
            oModel.setProperty("/gatePasses", []);
            oModel.setProperty("/gatePass_ID", "");
            oModel.setProperty("/gatePassNumber", "");
            this._mGatePassById = {};
            var fnLoadFallbackGatePasses = function () {
                var oFallbackListBinding = oODataModel.bindList("/GatePasses", null, null, null, {
                    $select: "ID,gatePassNumber,gateEntry_ID,gateEntryNumber,vehicleNumber,partyName",
                    $expand: "items"
                });
                oFallbackListBinding.requestContexts(0, 1000).then(function (aFallbackContexts) {
                    if (iRequestSeq !== this._iGatePassLoadSeq) {
                        return;
                    }
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
                    this._mGatePassById = {};
                    aFallbackGatePasses.forEach(function (oPass) {
                        if (oPass && oPass.ID) {
                            this._mGatePassById[oPass.ID] = oPass;
                        }
                    }.bind(this));
                    oModel.setProperty("/gatePasses", aFallbackGatePasses);
                    if (!(oModel.getProperty("/items") || []).length && aFallbackGatePasses.length) {
                        var oFirstPass = aFallbackGatePasses[0];
                        oModel.setProperty("/items", this._normalizeItems(oFirstPass.items || []));
                    }
                }).catch(function (oError) {
                    if (iRequestSeq !== this._iGatePassLoadSeq) {
                        return;
                    }
                    var sMessage = String((oError && (oError.message || oError.cause || oError.error)) || "");
                    if (oError && oError.canceled) {
                        return;
                    }
                    if (/abort|aborted|cancel/i.test(sMessage)) {
                        return;
                    }
                    MessageToast.show("Could not load Gate Passes");
                }.bind(this));
            }.bind(this);
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
            this._ensureExitDateTimeEditable();
            if (oSelectedEntry) {
                this._applyGateEntrySnapshot(oSelectedEntry);
            }
            this._loadGatePassesForEntry(sSelectedKey, sGateEntryNumber);
            var oODataModel = this.getView().getModel();
            if (!oODataModel) {
                return;
            }
            var oListBinding = oODataModel.bindList("/GateEntries");
            oListBinding.requestContexts(0, 1000).then(function (aContexts) {
                var oFreshContext = aContexts.find(function (oCtx) {
                    var oEntry = oCtx.getObject();
                    return oEntry && oEntry.ID === sSelectedKey;
                });
                if (!oFreshContext) {
                    return;
                }
                var oFreshEntry = oFreshContext.getObject() || {};
                var sFreshGateEntryNumber = oFreshEntry.gateEntryNumber || sGateEntryNumber;
                this._applyGateEntrySnapshot(oFreshEntry);
                oModel.setProperty("/gateEntryNumber", sFreshGateEntryNumber);
                var aEntries = oModel.getProperty("/passIssuedEntries") || [];
                oModel.setProperty("/passIssuedEntries", aEntries.map(function (oEntry) {
                    if (!oEntry || oEntry.ID !== sSelectedKey) {
                        return oEntry;
                    }
                    return Object.assign({}, oEntry, oFreshEntry);
                }));
                if (sFreshGateEntryNumber !== sGateEntryNumber) {
                    this._loadGatePassesForEntry(sSelectedKey, sFreshGateEntryNumber);
                }
            }.bind(this)).catch(function () {
                // Keep already applied values if refresh lookup fails
            });
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
            var oSelectedPass = this._mGatePassById[sSelectedKey];
            if (oSelectedPass) {
                oModel.setProperty("/items", this._normalizeItems(oSelectedPass.items || []));
            }
            var oODataModel = this.getView().getModel();
            if (!oODataModel) {
                return;
            }
            var oListBinding = oODataModel.bindList("/GatePasses", null, null, null, {
                $expand: "items"
            });
            oListBinding.requestContexts(0, 1000).then(function (aContexts) {
                var oFreshContext = aContexts.find(function (oCtx) {
                    var oPass = oCtx.getObject();
                    return oPass && oPass.ID === sSelectedKey;
                });
                if (!oFreshContext) {
                    return;
                }
                var oFreshPass = oFreshContext.getObject() || {};
                this._mGatePassById[sSelectedKey] = oFreshPass;
                if (oModel.getProperty("/gatePass_ID") === sSelectedKey) {
                    oModel.setProperty("/items", this._normalizeItems(oFreshPass.items || []));
                }
            }.bind(this)).catch(function () {
                // Keep currently shown item snapshot if refresh lookup fails
            });
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
            var sExitDate = this._toEdmDate(oData.exitDate);
            var sExitTime = this._toEdmTime(oData.exitTime);
            if (!sExitDate || !sExitTime) {
                MessageBox.error("Exit Date/Time is invalid");
                return;
            }
            oAction.setParameter("exitDate", sExitDate);
            oAction.setParameter("exitTime", sExitTime);
            oAction.setParameter("clientTimezoneOffsetMinutes", new Date().getTimezoneOffset());
            var sSecurityOfficer = (oData.securityOfficer || "").toString().trim();
            if (sSecurityOfficer) {
                oAction.setParameter("securityOfficer", sSecurityOfficer);
            }
            var sRemarks = (oData.remarks || "").toString().trim();
            if (sRemarks) {
                oAction.setParameter("remarks", sRemarks);
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
            this._ensureExitDateTimeEditable();
            MessageToast.show("Form cleared");
        },

        onAfterRendering: function () {
            this._ensureExitDateTimeEditable();
        },

        onNavBack: function () {
            this.getOwnerComponent().getRouter().navTo("Dashboard");
        }
    });
});
