'use strict';

var server = require('server');
server.extend(module.superModule);

// Settles the referral on the basket before the base route creates the order:
// voucher ownership, the confirmed attribution, and the prepaid-only rule.
server.prepend('PlaceOrder', function (req, res, next) {
    var affiliate = require('*/cartridge/scripts/helpers/affiliateHelper');
    var basket = require('dw/order/BasketMgr').getCurrentBasket();
    if (!basket || !affiliate.enabled()) return next();
    var buyer = affiliate.buyer(req, basket);
    var couponCodes = basket.couponLineItems.toArray().map(function (line) { return line.couponCode; });
    var errorKey = require('*/cartridge/scripts/helpers/affiliateRewardHelper').couponError(couponCodes, buyer.customerNo);
    var attribution = affiliate.resolve(basket, affiliate.referralFromCookie(request), buyer);
    if (attribution && !affiliate.eligibleLines(basket).length) attribution = null;
    if (!errorKey && attribution && !affiliate.prepaid(basket)) errorKey = 'error.prepaid.required';
    if (errorKey) {
        res.json({ error: true, errorMessage: require('dw/web/Resource').msg(errorKey, 'affiliate', null) });
        this.done(req, res);
        return null;
    }
    require('dw/system/Transaction').wrap(function () {
        basket.custom.affiliateCode = attribution ? attribution.code : null;
        basket.custom.affiliateSource = attribution ? attribution.source : null;
    });
    return next();
});

module.exports = server.exports();
