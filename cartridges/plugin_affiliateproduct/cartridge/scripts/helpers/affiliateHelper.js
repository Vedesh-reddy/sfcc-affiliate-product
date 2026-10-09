'use strict';

var CustomObjectMgr = require('dw/object/CustomObjectMgr');
var Transaction = require('dw/system/Transaction');
var Site = require('dw/system/Site');
var Logger = require('dw/system/Logger');

// No 0/O or 1/I, so codes survive being read aloud or copied by hand.
var ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
var CODE_PATTERN = /^[2-9A-HJ-NP-Z]{8}$/;
var COOKIE_NAME = 'affiliate-ref';
var DAY = 86400000;
var defaults = {
    AffiliateRewardPercent: 10,
    AffiliateVoucherValidityDays: 30,
    AffiliateAttributionWindowDays: 30,
    AffiliateRewardDelayDays: 7,
    AffiliateMinimumOrderValue: 0,
    AffiliateExpiryReminderDays: 5,
    AffiliatePrepaidPaymentMethods: ['CREDIT_CARD']
};

/**
 * Reads a site preference, falling back to the documented default when it is unset.
 * @param {string} name - site preference ID
 * @returns {*} preference value
 */
function pref(name) {
    var value = Site.current.getCustomPreferenceValue(name);
    if (value && typeof value.length === 'number' && typeof value !== 'string') {
        value = Array.prototype.slice.call(value);
        return value.length ? value : defaults[name];
    }
    return value === null || value === undefined ? defaults[name] : value;
}

/**
 * @returns {boolean} whether the program is switched on for the current site
 */
function enabled() {
    return Site.current.getCustomPreferenceValue('AffiliateProgramEnabled') === true;
}

/**
 * @param {*} value - shopper-entered or URL-supplied code
 * @returns {string|null} the canonical code, or null when it cannot be one
 */
function normalize(value) {
    var code = String(value || '').trim().toUpperCase();
    return CODE_PATTERN.test(code) ? code : null;
}

/**
 * @returns {string} a random 8-character code
 */
function generateCode() {
    var SecureRandom = require('dw/crypto/SecureRandom');
    var random = new SecureRandom();
    var code = '';
    for (var i = 0; i < 8; i += 1) {
        code += ALPHABET.charAt(random.nextInt(ALPHABET.length));
    }
    return code;
}

/**
 * @param {string} code - affiliate code
 * @returns {dw.object.CustomObject|null} the profile
 */
function getProfile(code) {
    var key = normalize(code);
    return key ? CustomObjectMgr.getCustomObject('AffiliateProfile', key) : null;
}

/**
 * @param {string} code - affiliate code
 * @returns {dw.object.CustomObject|null} the profile when it may earn rewards
 */
function getActiveProfile(code) {
    var profile = getProfile(code);
    return profile && profile.custom.status === 'ACTIVE' ? profile : null;
}

/**
 * @param {string} customerNo - customer number
 * @returns {dw.object.CustomObject|null} the customer's current profile
 */
function profileForCustomer(customerNo) {
    var index = customerNo ? CustomObjectMgr.getCustomObject('AffiliateCustomerIndex', customerNo) : null;
    return index ? getProfile(index.custom.affiliateCode) : null;
}

/**
 * Creates the profile and points the customer index at it.
 * @param {string} customerNo - customer number
 * @param {string} code - unused affiliate code
 * @returns {dw.object.CustomObject} the profile
 */
function createProfile(customerNo, code) {
    return Transaction.wrap(function () {
        var index = CustomObjectMgr.getCustomObject('AffiliateCustomerIndex', customerNo)
            || CustomObjectMgr.createCustomObject('AffiliateCustomerIndex', customerNo);
        var profile = CustomObjectMgr.createCustomObject('AffiliateProfile', code);
        index.custom.affiliateCode = code;
        profile.custom.customerNo = customerNo;
        profile.custom.status = 'ACTIVE';
        profile.custom.totalClicks = 0;
        profile.custom.totalOrders = 0;
        profile.custom.totalDeliveredOrders = 0;
        profile.custom.totalRewards = 0;
        profile.custom.lastActivityAt = new Date();
        return profile;
    });
}

/**
 * Returns the customer's affiliate profile, creating it on first use. A merchant
 * rotates a code by setting the profile status to ROTATED; the next join issues a new one.
 * @param {string} customerNo - authenticated customer number
 * @returns {dw.object.CustomObject} the profile
 */
function join(customerNo) {
    for (var attempt = 0; attempt < 5; attempt += 1) {
        var existing = profileForCustomer(customerNo);
        if (existing && existing.custom.status !== 'ROTATED') return existing;
        var code = generateCode();
        if (!getProfile(code)) {
            try {
                return createProfile(customerNo, code);
            } catch (e) {
                // The index key is unique: a concurrent join for the same customer fails here and the next pass returns its profile.
                Logger.getLogger('affiliate-product', 'affiliate-identity').warn('Affiliate join retried; attempt={0}', attempt + 1);
            }
        }
    }
    throw new Error('AFFILIATE_CODE_UNAVAILABLE');
}

/**
 * Increments a profile total and the matching daily counter. Best effort, in its own transaction.
 * ponytail: counters are last-write-wins under concurrency | upgrade path: export events to an analytics platform when exact counts matter
 * @param {string} code - affiliate code
 * @param {string|null} profileField - AffiliateProfile counter
 * @param {string|null} statsField - AffiliateDailyStats counter
 */
function count(code, profileField, statsField) {
    try {
        Transaction.wrap(function () {
            var profile = getProfile(code);
            if (profile && profileField) {
                profile.custom[profileField] = (profile.custom[profileField] || 0) + 1;
                profile.custom.lastActivityAt = new Date();
            }
            if (statsField) {
                var day = new Date().toISOString().slice(0, 10);
                var stats = CustomObjectMgr.getCustomObject('AffiliateDailyStats', code + ':' + day);
                if (!stats) {
                    stats = CustomObjectMgr.createCustomObject('AffiliateDailyStats', code + ':' + day);
                    stats.custom.affiliateCode = code;
                    stats.custom.day = day;
                }
                stats.custom[statsField] = (stats.custom[statsField] || 0) + 1;
            }
        });
    } catch (e) {
        Logger.getLogger('affiliate-product', 'affiliate-stats').warn('Counter {0} not updated for {1}', statsField || profileField, code);
    }
}

/**
 * Remembers a referral link in a first-party cookie for the attribution window.
 * The cookie only names a public code, so tampering gains nothing a shopper could not type at checkout.
 * @param {string} code - validated affiliate code
 * @param {dw.system.Response} response - platform response
 */
function rememberReferral(code, response) {
    var Cookie = require('dw/web/Cookie');
    var cookie = new Cookie(COOKIE_NAME, code + '.' + Date.now());
    cookie.setMaxAge(pref('AffiliateAttributionWindowDays') * 86400);
    cookie.setPath('/');
    cookie.setHttpOnly(true);
    cookie.setSecure(true);
    response.addHttpCookie(cookie);
}

/**
 * @param {dw.system.Request} request - platform request
 * @returns {string|null} the referral code still inside the attribution window
 */
function referralFromCookie(request) {
    var cookie = request.httpCookies[COOKIE_NAME];
    var parts = cookie ? String(cookie.value).split('.') : [];
    var clickedAt = Number(parts[1]);
    if (!clickedAt || Date.now() - clickedAt > pref('AffiliateAttributionWindowDays') * DAY) return null;
    return normalize(parts[0]);
}

/**
 * @param {dw.object.CustomObject} profile - referrer profile
 * @param {{customerNo: ?string, email: ?string}} shopper - the shopper
 * @returns {boolean} true when the shopper is the referrer
 */
function isSelfReferral(profile, shopper) {
    if (shopper.customerNo && shopper.customerNo === profile.custom.customerNo) return true;
    if (!shopper.email) return false;
    var referrer = require('dw/customer/CustomerMgr').getCustomerByCustomerNumber(profile.custom.customerNo);
    return !!(referrer && referrer.profile && String(referrer.profile.email).toLowerCase() === String(shopper.email).toLowerCase());
}

/**
 * Attribution policy: a code the shopper confirmed at checkout wins over a referral link,
 * and removing the referral at checkout ignores the link too.
 * @param {dw.order.Basket} basket - current basket
 * @param {string|null} linkCode - code from the referral cookie
 * @param {{customerNo: ?string, email: ?string}} shopper - the shopper
 * @returns {{code: string, source: string, profile: dw.object.CustomObject}|null} attribution
 */
function resolve(basket, linkCode, shopper) {
    if (!basket || basket.custom.affiliateOptOut) return null;
    var code = normalize(basket.custom.affiliateCode);
    var source = code ? 'CHECKOUT' : 'LINK';
    code = code || linkCode;
    var profile = getActiveProfile(code);
    if (!profile || isSelfReferral(profile, shopper)) return null;
    return { code: code, source: source, profile: profile };
}

/**
 * @param {Object} req - SFRA request
 * @param {dw.order.Basket} basket - current basket
 * @returns {{customerNo: ?string, email: ?string}} the shopper, for self-referral checks
 */
function buyer(req, basket) {
    return { customerNo: req.currentCustomer.profile ? req.currentCustomer.profile.customerNo : null, email: basket.customerEmail };
}

/**
 * @param {dw.order.Basket} basket - current basket
 * @param {Object} req - SFRA request
 * @returns {{code: ?string, source: ?string}} the referral the checkout panel shows
 */
function checkoutView(basket, req) {
    var attribution = resolve(basket, referralFromCookie(request), buyer(req, basket));
    return { code: attribution ? attribution.code : null, source: attribution ? attribution.source : null };
}

/**
 * @param {dw.order.LineItemCtnr} container - basket or order
 * @returns {Array} product line items that can earn a referral reward
 */
function eligibleLines(container) {
    return container.productLineItems.toArray().filter(function (line) {
        return line.product && !line.product.custom.affiliateExcluded;
    });
}

/**
 * @param {dw.order.LineItemCtnr} container - basket or order
 * @returns {boolean} true when every payment instrument is an allowed prepaid method
 */
function prepaid(container) {
    var allowed = pref('AffiliatePrepaidPaymentMethods');
    var instruments = container.paymentInstruments.toArray();
    return instruments.length > 0 && instruments.every(function (instrument) {
        return allowed.indexOf(instrument.paymentMethod) !== -1;
    });
}

/**
 * Snapshots the attribution of a placed order. Safe to call twice for the same order.
 * @param {dw.order.Order} order - placed order carrying custom.affiliateCode
 */
function recordOrder(order) {
    var code = order.custom.affiliateCode;
    var profile = getProfile(code);
    if (!profile || CustomObjectMgr.getCustomObject('AffiliateOrder', order.orderNo)) return;
    var lines = eligibleLines(order);
    Transaction.wrap(function () {
        var record = CustomObjectMgr.createCustomObject('AffiliateOrder', order.orderNo);
        record.custom.affiliateCode = code;
        record.custom.referrerCustomerNo = profile.custom.customerNo;
        record.custom.buyerCustomerNo = order.customerNo || null;
        record.custom.attributionSource = order.custom.affiliateSource;
        record.custom.rewardStatus = 'PENDING';
        record.custom.eligibleProductCount = lines.reduce(function (sum, line) { return sum + line.quantityValue; }, 0);
        record.custom.eligibleOrderValue = lines.reduce(function (sum, line) { return sum + line.proratedPrice.value; }, 0);
        record.custom.currency = order.currencyCode;
    });
    count(code, 'totalOrders', 'orders');
}

/**
 * Reads a bounded page of custom objects and always closes the iterator.
 * @param {string} type - custom object type
 * @param {string} condition - query condition
 * @param {Array} args - query arguments
 * @param {number} limit - maximum results
 * @param {string} [sort] - sort string
 * @returns {Array} custom objects
 */
function query(type, condition, args, limit, sort) {
    var iterator = CustomObjectMgr.queryCustomObjects.apply(CustomObjectMgr, [type, condition, sort || 'creationDate desc'].concat(args));
    var result = [];
    try {
        while (iterator.hasNext() && result.length < limit) result.push(iterator.next());
    } finally {
        iterator.close();
    }
    return result;
}

module.exports = {
    COOKIE_NAME: COOKIE_NAME,
    pref: pref,
    enabled: enabled,
    normalize: normalize,
    generateCode: generateCode,
    getProfile: getProfile,
    getActiveProfile: getActiveProfile,
    profileForCustomer: profileForCustomer,
    join: join,
    count: count,
    rememberReferral: rememberReferral,
    referralFromCookie: referralFromCookie,
    isSelfReferral: isSelfReferral,
    resolve: resolve,
    buyer: buyer,
    checkoutView: checkoutView,
    eligibleLines: eligibleLines,
    prepaid: prepaid,
    recordOrder: recordOrder,
    query: query
};
