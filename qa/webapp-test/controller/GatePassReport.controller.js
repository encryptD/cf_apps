sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/m/MessageToast",
    "sap/ui/export/Spreadsheet"
], function (Controller, JSONModel, Filter, FilterOperator, MessageToast, Spreadsheet) {
    "use strict";

    // Column metadata for Excel export (view columns are declared statically in GatePassReport.view.xml)
    var REPORT_COLUMNS = [
        { key: "gateEntryNumber", i18n: "gateEntryNumber", type: "string" },
        { key: "entryDate", i18n: "entryDate", type: "date" },
        { key: "purchasingDocNo", i18n: "repPurchasingDocNo", type: "string" },
        { key: "poItem", i18n: "repPOItem", type: "string" },
        { key: "plant", i18n: "plant", type: "string" },
        { key: "materialNumber", i18n: "repMaterialNumber", type: "string" },
        { key: "materialDescription", i18n: "repMaterialDescription", type: "string" },
        { key: "poQuantity", i18n: "repPOQuantity", type: "number" },
        { key: "poUnit", i18n: "repPOUnit", type: "string" },
        { key: "vendorCode", i18n: "repVendorCode", type: "string" },
        { key: "vendorName", i18n: "repVendorName", type: "string" },
        { key: "invoiceNumber", i18n: "repInvoiceNo", type: "string" },
        { key: "invoiceDate", i18n: "repInvoiceDate", type: "date" },
        { key: "vehicleNumber", i18n: "vehicleNumber", type: "string" },
        { key: "vehicleType", i18n: "vehicleType", type: "string" },
        { key: "transportNo", i18n: "repTransportNo", type: "string" },
        { key: "transportName", i18n: "repTransportName", type: "string" },
        { key: "lrNumber", i18n: "repLRNumber", type: "string" },
        { key: "challanQty", i18n: "repChallanQty", type: "number" },
        { key: "balanceQty", i18n: "repBalanceQty", type: "number" },
        { key: "grnNumber", i18n: "repGRNNo", type: "string" },
        { key: "grnYear", i18n: "repGRNYear", type: "string" },
        { key: "grnPostingDate", i18n: "repGRNPostingDate", type: "date" },
        { key: "grnStorageLocation", i18n: "repGRNStorageLoc", type: "string" },
        { key: "grnQuantity", i18n: "repGRNQuantity", type: "number" },
        { key: "gateExitNumber", i18n: "repGateEntryExit", type: "string" },
        { key: "exitDate", i18n: "repGateEntryExitDate", type: "date" }
    ];

    return Controller.extend("com.mdasad.gatepass.controller.GatePassReport", {

        onInit: function () {
            var oModel = new JSONModel({
                isLoading: false,
                rows: [],
                filterGateEntry: "",
                filterReference: "",
                filterVendor: "",
                filterPlant: "",
                entryDateRange: null
            });
            this.getView().setModel(oModel, "report");
            this.getOwnerComponent().getRouter().getRoute("GatePassReport").attachPatternMatched(this._onRouteMatched, this);
        },

        _onRouteMatched: function () {
            this._loadReport();
        },

        _getI18nText: function (sKey, aArgs, sFallback) {
            var oI18nModel = this.getView().getModel("i18n") || this.getOwnerComponent().getModel("i18n");
            if (!oI18nModel) {
                return sFallback || sKey;
            }
            return oI18nModel.getResourceBundle().getText(sKey, aArgs || []);
        },

        _loadReport: function () {
            var oODataModel = this.getView().getModel();
            var oModel = this.getView().getModel("report");
            if (!oODataModel) {
                return;
            }
            oModel.setProperty("/isLoading", true);
            var oFunction = oODataModel.bindContext("/getGatePassReport(...)");
            oFunction.execute().then(function () {
                var oResult = oFunction.getBoundContext().getObject() || {};
                var aRows = [];
                try {
                    aRows = JSON.parse(oResult.rowsJson || "[]");
                } catch (e) {
                    aRows = [];
                }
                oModel.setProperty("/rows", Array.isArray(aRows) ? aRows : []);
                this._applyFilters();
            }.bind(this)).catch(function () {
                MessageToast.show(this._getI18nText("repLoadFailed", null, "Could not load the Gate Pass Report"));
            }.bind(this)).finally(function () {
                oModel.setProperty("/isLoading", false);
            });
        },

        onSearch: function () {
            this._applyFilters();
        },

        onClearFilters: function () {
            var oModel = this.getView().getModel("report");
            oModel.setProperty("/filterGateEntry", "");
            oModel.setProperty("/filterReference", "");
            oModel.setProperty("/filterVendor", "");
            oModel.setProperty("/filterPlant", "");
            oModel.setProperty("/entryDateRange", null);
            this._applyFilters();
        },

        _toISODate: function (oDate) {
            var y = oDate.getFullYear();
            var m = String(oDate.getMonth() + 1).padStart(2, "0");
            var d = String(oDate.getDate()).padStart(2, "0");
            return y + "-" + m + "-" + d;
        },

        _applyFilters: function () {
            var oModel = this.getView().getModel("report");
            var aFilters = [];

            var sGateEntry = (oModel.getProperty("/filterGateEntry") || "").trim();
            if (sGateEntry) {
                aFilters.push(new Filter("gateEntryNumber", FilterOperator.Contains, sGateEntry));
            }

            var sReference = (oModel.getProperty("/filterReference") || "").trim();
            if (sReference) {
                aFilters.push(new Filter({
                    filters: [
                        new Filter("purchasingDocNo", FilterOperator.Contains, sReference),
                        new Filter("invoiceNumber", FilterOperator.Contains, sReference)
                    ],
                    and: false
                }));
            }

            var sVendor = (oModel.getProperty("/filterVendor") || "").trim();
            if (sVendor) {
                aFilters.push(new Filter({
                    filters: [
                        new Filter("vendorName", FilterOperator.Contains, sVendor),
                        new Filter("vendorCode", FilterOperator.Contains, sVendor)
                    ],
                    and: false
                }));
            }

            var sPlant = (oModel.getProperty("/filterPlant") || "").trim();
            if (sPlant) {
                aFilters.push(new Filter("plant", FilterOperator.Contains, sPlant));
            }

            var oRange = this.byId("entryDateRange");
            var dFrom = oRange ? oRange.getDateValue() : null;
            if (dFrom) {
                var dTo = oRange.getSecondDateValue() || dFrom;
                aFilters.push(new Filter("entryDate", FilterOperator.BT, this._toISODate(dFrom), this._toISODate(dTo)));
            }

            var oTable = this.byId("reportTable");
            var oBinding = oTable ? oTable.getBinding("rows") : null;
            if (oBinding) {
                oBinding.filter(aFilters);
            }
        },

        onExport: function () {
            var oTable = this.byId("reportTable");
            var oBinding = oTable ? oTable.getBinding("rows") : null;
            var aRows = oBinding
                ? oBinding.getCurrentContexts().map(function (oContext) { return oContext.getObject(); })
                : (this.getView().getModel("report").getProperty("/rows") || []);
            var aCols = REPORT_COLUMNS.map(function (oCol) {
                return {
                    label: this._getI18nText(oCol.i18n, null, oCol.key),
                    property: oCol.key,
                    type: oCol.type
                };
            }.bind(this));
            var oSheet = new Spreadsheet({
                workbook: { columns: aCols },
                dataSource: aRows,
                fileName: "GatePassReport.xlsx"
            });
            oSheet.build().finally(function () {
                oSheet.destroy();
            });
        },

        onNavBack: function () {
            this.getOwnerComponent().getRouter().navTo("Dashboard");
        }
    });
});
