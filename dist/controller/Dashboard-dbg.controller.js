sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel"
], function (Controller, JSONModel) {
    "use strict";

    return Controller.extend("com.mdasad.gatepass.controller.Dashboard", {

        onInit: function () {
            var sRole = this._getRoleFromQuery() || "ADMIN";
            var oModel = new JSONModel({
                userRole: sRole, // Defaults to ADMIN until auth context is wired
                sections: [
                    {
                        id: "gateEntry",
                        title: "{i18n>gateEntryTitle}",
                        subtitle: "{i18n>gateEntrySubtitle}",
                        icon: "sap-icon://log",
                        roles: ["SECURITY"],
                        route: "GateEntryList"
                    },
                    {
                        id: "gatePass",
                        title: "{i18n>gatePassTitle}",
                        subtitle: "{i18n>gatePassSubtitle}",
                        icon: "sap-icon://product",
                        roles: ["WAREHOUSE"],
                        route: "GatePassList"
                    },
                    {
                        id: "gateExit",
                        title: "{i18n>gateExitTitle}",
                        subtitle: "{i18n>gateExitSubtitle}",
                        icon: "sap-icon://log",
                        roles: ["SECURITY"],
                        route: "GateExit"
                    }
                ]
            });
            this.getView().setModel(oModel, "dashboard");
            this._filterSectionsByRole();
        },

        _getRoleFromQuery: function () {
            var oParams = new URLSearchParams(window.location.search);
            var sRole = oParams.get("role");
            return sRole ? sRole.toUpperCase() : "";
        },

        _filterSectionsByRole: function () {
            var oModel = this.getView().getModel("dashboard");
            var sRole = oModel.getProperty("/userRole");
            var aSections = oModel.getProperty("/sections");
            var aFiltered = aSections.filter(function (oSection) {
                return oSection.roles.indexOf(sRole) !== -1 || sRole === "ADMIN";
            });
            oModel.setProperty("/visibleSections", aFiltered);
        },

        onTilePress: function (oEvent) {
            var oSource = oEvent.getSource();
            var sRoute = oSource.data("route");
            if (sRoute) {
                this.getOwnerComponent().getRouter().navTo(sRoute);
            }
        }
    });
});