'use strict';

var base = module.superModule;
var Transaction = require('dw/system/Transaction');
var Logger = require('dw/system/Logger');

module.exports = Object.assign({}, base, {
    createOrder: function (basket) {
        // Read before the platform turns the basket into the order.
        var code = basket.custom.affiliateCode;
        var source = basket.custom.affiliateSource;
        var order = base.createOrder(basket);
        if (order && code && require('*/cartridge/scripts/helpers/affiliateHelper').enabled()) {
            // Copied explicitly instead of assuming basket custom attributes reach the order.
            Transaction.wrap(function () {
                order.custom.affiliateCode = code;
                order.custom.affiliateSource = source;
            });
        }
        return order;
    },
    placeOrder: function (order, fraudDetectionStatus) {
        var result = base.placeOrder(order, fraudDetectionStatus);
        if (!result.error) {
            try {
                if (order.custom.affiliateCode) require('*/cartridge/scripts/helpers/affiliateHelper').recordOrder(order);
                require('*/cartridge/scripts/helpers/affiliateRewardHelper').markRedeemed(order);
            } catch (e) {
                // The order is placed; a missing snapshot is a reconciliation task, not a checkout failure.
                Logger.getLogger('affiliate-product', 'referral-attribution').error('Attribution not recorded for order {0}: {1}', order.orderNo, e.message);
            }
        }
        return result;
    }
});
