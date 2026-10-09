'use strict';

var server = require('server');
server.extend(module.superModule);

// Affiliate vouchers are bound to the affiliate who earned them; checked again at PlaceOrder.
server.prepend('AddCoupon', function (req, res, next) {
    var affiliate = require('*/cartridge/scripts/helpers/affiliateHelper');
    var basket = require('dw/order/BasketMgr').getCurrentBasket();
    if (!basket || !affiliate.enabled()) return next();
    var couponCodes = basket.couponLineItems.toArray().map(function (line) { return line.couponCode; }).concat(req.querystring.couponCode || '');
    var customerNo = req.currentCustomer.profile ? req.currentCustomer.profile.customerNo : null;
    var errorKey = require('*/cartridge/scripts/helpers/affiliateRewardHelper').couponError(couponCodes, customerNo);
    if (errorKey) {
        res.json({ error: true, errorMessage: require('dw/web/Resource').msg(errorKey, 'affiliate', null) });
        this.done(req, res);
        return null;
    }
    return next();
});

module.exports = server.exports();
