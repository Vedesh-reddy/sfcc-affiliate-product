'use strict';

// Small in-memory Script API double for the affiliate helpers. It checks domain rules, not platform isolation.
var Module = require('module');
var path = require('path');

var root = path.resolve(__dirname, '../../../cartridges/plugin_affiliateproduct/cartridge');
var active = {};
var original = Module._load; // eslint-disable-line no-underscore-dangle

// Helpers require dw modules lazily, so the resolver stays installed and serves the current harness.
// Only cartridge modules are redirected, so other suites in the same mocha run are unaffected.
Module._load = function (request, parent, isMain) { // eslint-disable-line no-underscore-dangle
    var ours = parent && parent.filename && parent.filename.indexOf(root) === 0;
    if (ours && active[request]) return active[request];
    if (ours && request.indexOf('*/cartridge/') === 0) return original.call(this, path.join(root, request.slice(12)), parent, isMain);
    return original.call(this, request, parent, isMain);
};

function harness() {
    var db = {};
    var preferences = { AffiliateProgramEnabled: true, AffiliateRewardCouponID: 'affiliate-reward' };
    var customers = {};
    var orders = {};
    var emails = [];
    var couponCodes = ['AX10-K7P2Q9', 'AX10-M3R8T5'];
    var randomSequence = null;

    function array(values) {
        return {
            toArray: function () { return values.slice(); },
            size: function () { return values.length; }
        };
    }
    function transactionWrap(fn) {
        var snapshot = {};
        Object.keys(db).forEach(function (id) { snapshot[id] = Object.assign({}, db[id].custom); });
        try {
            return fn();
        } catch (e) {
            Object.keys(db).forEach(function (id) {
                if (!(id in snapshot)) delete db[id];
                else db[id].custom = snapshot[id];
            });
            throw e;
        }
    }
    var customObjectMgr = {
        getCustomObject: function (type, key) { return db[type + ':' + key] || null; },
        createCustomObject: function (type, key) {
            var id = type + ':' + key;
            if (db[id]) throw new Error('UNIQUE_CONSTRAINT');
            db[id] = { type: type, custom: { key: key }, creationDate: new Date() };
            return db[id];
        },
        queryCustomObjects: function (type, condition) {
            var args = Array.prototype.slice.call(arguments, 3);
            var fields = (condition.match(/custom\.\w+/g) || []).map(function (f) { return f.slice(7); });
            var ops = condition.match(/(>=|=)/g) || [];
            var rows = Object.keys(db).map(function (id) { return db[id]; }).filter(function (row) {
                return row.type === type && fields.every(function (field, i) {
                    return ops[i] === '>=' ? row.custom[field] >= args[i] : row.custom[field] === args[i];
                });
            });
            var i = 0;
            return { hasNext: function () { return i < rows.length; }, next: function () { return rows[i++]; }, close: function () {} };
        }
    };
    var Order = { ORDER_STATUS_CANCELLED: 6, ORDER_STATUS_FAILED: 8, ORDER_STATUS_NEW: 3, PAYMENT_STATUS_PAID: 2, PAYMENT_STATUS_NOTPAID: 0, SHIPPING_STATUS_SHIPPED: 2, SHIPPING_STATUS_NOTSHIPPED: 0 };
    var stubs = {
        'dw/object/CustomObjectMgr': customObjectMgr,
        'dw/system/Transaction': { wrap: transactionWrap },
        'dw/system/Site': { current: { getCustomPreferenceValue: function (name) { return name in preferences ? preferences[name] : null; } } },
        'dw/system/Logger': { getLogger: function () { return { warn: function () {}, info: function () {}, error: function () {} }; } },
        'dw/crypto/SecureRandom': function () {
            this.nextInt = function (n) { return randomSequence ? randomSequence.shift() : Math.floor(Math.random() * n); };
        },
        'dw/customer/CustomerMgr': { getCustomerByCustomerNumber: function (no) { return customers[no] || null; } },
        'dw/order/Order': Order,
        'dw/order/Shipment': { SHIPPING_STATUS_SHIPPED: 2, SHIPPING_STATUS_NOTSHIPPED: 0 },
        'dw/order/OrderMgr': { getOrder: function (no) { return orders[no] || null; } },
        'dw/campaign/CouponMgr': {
            getCoupon: function (id) {
                return id === 'affiliate-reward' ? { enabled: true, getNextCouponCode: function () { return couponCodes.shift() || null; } } : null;
            }
        },
        'dw/web/Resource': { msg: function (key) { return key; } },
        'dw/web/URLUtils': { https: function () { return 'https://example.test/dashboard'; } },
        '*/cartridge/scripts/helpers/emailHelpers': { send: function (obj, template, context) { emails.push({ to: obj.to, template: template, context: context }); } }
    };

    function load(relative) {
        var file = path.join(root, relative);
        Object.keys(require.cache).forEach(function (key) { if (key.indexOf(root) === 0) delete require.cache[key]; });
        active = stubs;
        return require(file);
    }

    function order(no, fields) {
        orders[no] = Object.assign({
            orderNo: no,
            status: { value: Order.ORDER_STATUS_NEW },
            paymentStatus: { value: Order.PAYMENT_STATUS_PAID },
            shippingStatus: { value: Order.SHIPPING_STATUS_SHIPPED },
            shipments: array([]),
            returnCases: array([])
        }, fields);
        return orders[no];
    }

    return {
        db: db,
        Order: Order,
        preferences: preferences,
        emails: emails,
        array: array,
        load: load,
        order: order,
        customer: function (no, email) { customers[no] = { profile: { customerNo: no, email: email, firstName: 'Asha' } }; },
        random: function (values) { randomSequence = values.slice(); }
    };
}

module.exports = harness;
