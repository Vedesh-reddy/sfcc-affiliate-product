'use strict';

var server = require('server');
var BasketMgr = require('dw/order/BasketMgr');
var Resource = require('dw/web/Resource');
var Transaction = require('dw/system/Transaction');
var csrfProtection = require('*/cartridge/scripts/middleware/csrf');
var affiliate = require('*/cartridge/scripts/helpers/affiliateHelper');

// ponytail: per-session cap on code attempts | upgrade path: add an IP-level limit if codes are ever enumerated at scale
var MAX_ATTEMPTS = 10;

/**
 * Renders the checkout panel so the client can swap it in after a change.
 * @param {Object} req - request
 * @param {dw.order.Basket} basket - current basket
 * @returns {string} panel HTML
 */
function panel(req, basket) {
    var CSRFProtection = require('dw/web/CSRFProtection');
    return require('*/cartridge/scripts/renderTemplateHelper').getRenderedHtml({
        affiliateCheckout: affiliate.checkoutView(basket, req),
        csrf: { tokenName: CSRFProtection.getTokenName(), token: CSRFProtection.generateToken() }
    }, 'affiliate/checkoutPanel');
}

/**
 * Ends the route with a JSON error.
 * @param {Object} route - route context
 * @param {Object} req - request
 * @param {Object} res - response
 * @param {string} key - affiliate resource key
 */
function fail(route, req, res, key) {
    res.json({ success: false, errorMessage: Resource.msg(key, 'affiliate', null) });
    route.done(req, res);
}

server.post('Apply', server.middleware.https, csrfProtection.validateAjaxRequest, function (req, res, next) {
    var basket = BasketMgr.getCurrentBasket();
    if (!affiliate.enabled() || !basket) return fail(this, req, res, 'error.code.invalid');
    var attempts = (req.session.privacyCache.get('affiliateAttempts') || 0) + 1;
    req.session.privacyCache.set('affiliateAttempts', attempts);
    if (attempts > MAX_ATTEMPTS) return fail(this, req, res, 'error.code.attempts');
    var code = affiliate.normalize(req.form.affiliateCode);
    var profile = code ? affiliate.getActiveProfile(code) : null;
    if (!profile) return fail(this, req, res, 'error.code.invalid');
    if (affiliate.isSelfReferral(profile, affiliate.buyer(req, basket))) return fail(this, req, res, 'error.code.self');
    Transaction.wrap(function () {
        basket.custom.affiliateCode = code;
        basket.custom.affiliateSource = 'CHECKOUT';
        basket.custom.affiliateOptOut = false;
    });
    res.json({ success: true, panel: panel(req, basket) });
    return next();
});

server.post('Remove', server.middleware.https, csrfProtection.validateAjaxRequest, function (req, res, next) {
    var basket = BasketMgr.getCurrentBasket();
    if (!affiliate.enabled() || !basket) return fail(this, req, res, 'error.code.invalid');
    Transaction.wrap(function () {
        basket.custom.affiliateCode = null;
        basket.custom.affiliateSource = null;
        basket.custom.affiliateOptOut = true;
    });
    res.json({ success: true, panel: panel(req, basket) });
    return next();
});

module.exports = server.exports();
