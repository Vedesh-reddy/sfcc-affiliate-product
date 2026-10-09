'use strict';

var server = require('server');
var URLUtils = require('dw/web/URLUtils');
var Resource = require('dw/web/Resource');
var csrfProtection = require('*/cartridge/scripts/middleware/csrf');
var userLoggedIn = require('*/cartridge/scripts/middleware/userLoggedIn');
var affiliate = require('*/cartridge/scripts/helpers/affiliateHelper');

// Login-Show return slot registered in config/oAuthRenentryRedirectEndpoints.js.
var LOGIN_RETURN = 4;

/**
 * Stops the route with a 404 when the program is switched off.
 * @param {Object} req - request
 * @param {Object} res - response
 * @param {Function} next - next middleware
 * @returns {void}
 */
function requireProgram(req, res, next) {
    if (!affiliate.enabled()) {
        res.setStatusCode(404);
        res.render('error/notFound');
        this.done(req, res);
        return;
    }
    next();
}

/**
 * @param {dw.util.Date} date - date to format
 * @returns {string} yyyy-MM-dd in the site time zone
 */
function day(date) {
    var StringUtils = require('dw/util/StringUtils');
    var Calendar = require('dw/util/Calendar');
    return date ? StringUtils.formatCalendar(new Calendar(date), 'yyyy-MM-dd') : '';
}

server.get('Show', server.middleware.https, requireProgram, csrfProtection.generateToken, function (req, res, next) {
    var customerNo = req.currentCustomer.profile ? req.currentCustomer.profile.customerNo : null;
    var profile = affiliate.profileForCustomer(customerNo);
    res.render('affiliate/landing', {
        loggedIn: !!customerNo,
        loginUrl: URLUtils.https('Login-Show', 'rurl', LOGIN_RETURN).toString(),
        code: profile && profile.custom.status !== 'ROTATED' ? profile.custom.key : null,
        suspended: !!profile && profile.custom.status === 'SUSPENDED',
        percent: affiliate.pref('AffiliateRewardPercent'),
        days: affiliate.pref('AffiliateVoucherValidityDays'),
        breadcrumbs: [{ htmlValue: Resource.msg('global.home', 'common', null), url: URLUtils.home().toString() }]
    });
    next();
});

server.post('Generate', server.middleware.https, requireProgram, userLoggedIn.validateLoggedIn, csrfProtection.validateRequest, function (req, res, next) {
    if (req.currentCustomer.profile) {
        affiliate.join(req.currentCustomer.profile.customerNo);
        res.redirect(URLUtils.https('Affiliate-Show'));
    }
    next();
});

// Uncached remote include on the cached PDP: records the referral click and offers the logged-in affiliate a share link.
server.get('Share', server.middleware.include, requireProgram, function (req, res, next) {
    res.cachePeriod = 0;
    var customerNo = req.currentCustomer.profile ? req.currentCustomer.profile.customerNo : null;
    var linkCode = affiliate.normalize(req.querystring.aff);
    var linkProfile = linkCode ? affiliate.getActiveProfile(linkCode) : null;
    var referred = !!linkProfile && linkProfile.custom.customerNo !== customerNo;
    if (referred) {
        // One click per code per session, so refreshes are not counted.
        if (req.session.privacyCache.get('affiliateClick') !== linkCode) {
            req.session.privacyCache.set('affiliateClick', linkCode);
            affiliate.count(linkCode, 'totalClicks', 'clicks');
        }
        affiliate.rememberReferral(linkCode, res.base);
    }
    var own = affiliate.profileForCustomer(customerNo);
    var product = require('dw/catalog/ProductMgr').getProduct(String(req.querystring.pid || ''));
    var shareUrl = own && own.custom.status === 'ACTIVE' && product && !product.custom.affiliateExcluded
        ? URLUtils.https('Product-Show', 'pid', product.ID, 'aff', own.custom.key).toString() : null;
    res.render('affiliate/share', { referred: referred, shareUrl: shareUrl, pid: product ? product.ID : '' });
    next();
});

server.get('Dashboard', server.middleware.https, requireProgram, userLoggedIn.validateLoggedIn, function (req, res, next) {
    if (!req.currentCustomer.profile) return next();
    var profile = affiliate.profileForCustomer(req.currentCustomer.profile.customerNo);
    if (!profile || profile.custom.status === 'ROTATED') {
        res.redirect(URLUtils.https('Affiliate-Show'));
        return next();
    }
    var StringUtils = require('dw/util/StringUtils');
    var Money = require('dw/value/Money');
    var code = profile.custom.key;
    var now = Date.now();
    // Customer 2's privacy: the affiliate only ever sees the last four digits of an order number.
    var mask = function (orderNo) { return orderNo ? '••••' + String(orderNo).slice(-4) : ''; };
    var orders = affiliate.query('AffiliateOrder', 'custom.affiliateCode = {0}', [code], 20).map(function (record) {
        return {
            reference: mask(record.custom.key),
            date: day(record.creationDate),
            status: record.custom.rewardStatus,
            value: StringUtils.formatMoney(new Money(record.custom.eligibleOrderValue || 0, record.custom.currency))
        };
    });
    var rewards = affiliate.query('AffiliateReward', 'custom.affiliateCode = {0}', [code], 20).map(function (reward) {
        var expired = reward.custom.status === 'ISSUED' && reward.custom.expiresAt.getTime() <= now;
        return {
            couponCode: reward.custom.couponCode,
            percent: String(reward.custom.discountPercentage),
            status: expired ? 'EXPIRED' : reward.custom.status,
            issuedAt: day(reward.custom.issuedAt),
            expiresAt: day(reward.custom.expiresAt)
        };
    });
    var start = new Date();
    start.setUTCDate(1);
    start.setUTCMonth(start.getUTCMonth() - 5);
    var months = [];
    for (var i = 0; i < 6; i += 1) {
        var month = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1)).toISOString().slice(0, 7);
        months.push({ month: month, clicks: 0, orders: 0, delivered: 0 });
    }
    affiliate.query('AffiliateDailyStats', 'custom.affiliateCode = {0} AND custom.day >= {1}', [code, months[0].month + '-01'], 200).forEach(function (stats) {
        var row = months.filter(function (m) { return m.month === stats.custom.day.slice(0, 7); })[0];
        if (row) {
            row.clicks += stats.custom.clicks || 0;
            row.orders += stats.custom.orders || 0;
            row.delivered += stats.custom.deliveredOrders || 0;
        }
    });
    var maxClicks = Math.max.apply(null, months.map(function (m) { return m.clicks; }).concat(1));
    months.forEach(function (m) {
        // Strings, because ISML prints numbers with decimals ("1.0").
        m.width = String(Math.round((m.clicks / maxClicks) * 100));
        m.conversion = (m.clicks ? (m.orders / m.clicks) * 100 : 0).toFixed(1);
        m.clicks = String(m.clicks);
        m.orders = String(m.orders);
        m.delivered = String(m.delivered);
    });
    res.render('affiliate/dashboard', {
        code: code,
        status: profile.custom.status,
        totals: {
            clicks: String(profile.custom.totalClicks || 0),
            orders: String(profile.custom.totalOrders || 0),
            delivered: String(profile.custom.totalDeliveredOrders || 0),
            available: String(rewards.filter(function (r) { return r.status === 'ISSUED'; }).length)
        },
        orders: orders,
        rewards: rewards,
        months: months,
        breadcrumbs: [
            { htmlValue: Resource.msg('global.home', 'common', null), url: URLUtils.home().toString() },
            { htmlValue: Resource.msg('page.title.myaccount', 'account', null), url: URLUtils.url('Account-Show').toString() }
        ]
    });
    return next();
});

module.exports = server.exports();
