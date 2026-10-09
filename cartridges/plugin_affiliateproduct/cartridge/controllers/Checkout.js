'use strict';

var server = require('server');
server.extend(module.superModule);

server.append('Begin', function (req, res, next) {
    var affiliate = require('*/cartridge/scripts/helpers/affiliateHelper');
    var basket = require('dw/order/BasketMgr').getCurrentBasket();
    if (basket && affiliate.enabled()) {
        res.setViewData({ affiliateCheckout: affiliate.checkoutView(basket, req) });
    }
    next();
});

module.exports = server.exports();
