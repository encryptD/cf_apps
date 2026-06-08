sap.ui.define([], function () {
    "use strict";

    var aPOMockData = [
        {
            po_no: "5100000338",
            material_no: "MLRMIMAS0102HUI002",
            material_description: "##Adhesive Sealant (JB)HT906Z",
            po_qty: 10,
            vendor: "5300000016",
            vendor_name: "MAXWELL DISTRIBUTORS PVT LTD",
            plant: "WE02",
            item_no: 10
        },
        {
            po_no: "5100000339",
            material_no: "MLRMIMAS0102HUI002",
            material_description: "##Adhesive Sealant (JB)HT906Z",
            po_qty: 10,
            vendor: "5300000016",
            vendor_name: "MAXWELL DISTRIBUTORS PVT LTD",
            plant: "WE02",
            item_no: 10
        },
        {
            po_no: "5100000339",
            material_no: "1040000000020",
            material_description: "3MM LONG ALLENKEY STANLEY",
            po_qty: 20,
            vendor: "5300000016",
            vendor_name: "MAXWELL DISTRIBUTORS PVT LTD",
            plant: "WE02",
            item_no: 20
        }
    ];

    return {
        getAll: function () {
            return aPOMockData.slice();
        }
    };
});
