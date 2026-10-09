'use strict';

var assert = require('assert');
var harness = require('./harness');

var DAY = 86400000;

describe('Affiliate product', function () {
    var h;
    var affiliate;
    var rewards;

    beforeEach(function () {
        h = harness();
        affiliate = h.load('scripts/helpers/affiliateHelper');
        rewards = h.load('scripts/helpers/affiliateRewardHelper');
        h.customer('C1', 'referrer@example.test');
        h.customer('C2', 'buyer@example.test');
    });

    function line(fields) {
        return Object.assign({ product: { custom: {} }, quantityValue: 1, proratedPrice: { value: 100 } }, fields);
    }
    function basket(fields) {
        return Object.assign({
            custom: {},
            customerEmail: 'buyer@example.test',
            productLineItems: h.array([line()]),
            paymentInstruments: h.array([{ paymentMethod: 'CREDIT_CARD' }])
        }, fields);
    }
    function placedOrder(no, code, fields) {
        return h.order(no, Object.assign({
            customerNo: 'C2',
            currencyCode: 'INR',
            custom: { affiliateCode: code, affiliateSource: 'LINK' },
            productLineItems: h.array([line({ quantityValue: 2, proratedPrice: { value: 85000 } }), line({ product: { custom: { affiliateExcluded: true } } })]),
            couponLineItems: h.array([])
        }, fields));
    }
    function pendingRecord(code) {
        affiliate.recordOrder(placedOrder('0001', code));
        return h.db['AffiliateOrder:0001'];
    }

    describe('identity', function () {
        it('generates 8-character codes from an unambiguous alphabet', function () {
            for (var i = 0; i < 50; i += 1) {
                assert.ok(/^[2-9A-HJ-NP-Z]{8}$/.test(affiliate.generateCode()));
            }
        });

        it('normalizes shopper input and rejects ambiguous characters', function () {
            assert.equal(affiliate.normalize(' vr7k29qx '), 'VR7K29QX');
            assert.equal(affiliate.normalize('VR7K29Q0'), null);
            assert.equal(affiliate.normalize('VR7K29QXX'), null);
            assert.equal(affiliate.normalize(null), null);
        });

        it('returns the same identity on repeated joins', function () {
            var first = affiliate.join('C1').custom.key;
            assert.equal(affiliate.join('C1').custom.key, first);
            assert.equal(h.db['AffiliateCustomerIndex:C1'].custom.affiliateCode, first);
            assert.equal(Object.keys(h.db).filter(function (id) { return id.indexOf('AffiliateProfile:') === 0; }).length, 1);
        });

        it('retries when a generated code is already taken', function () {
            h.db['AffiliateProfile:22222222'] = { type: 'AffiliateProfile', custom: { key: '22222222', customerNo: 'OTHER', status: 'ACTIVE' } };
            h.random([0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1]);
            assert.equal(affiliate.join('C1').custom.key, '33333333');
            assert.equal(h.db['AffiliateProfile:22222222'].custom.customerNo, 'OTHER');
        });

        it('issues a new code after the merchant rotates the old one', function () {
            var old = affiliate.join('C1');
            old.custom.status = 'ROTATED';
            var next = affiliate.join('C1');
            assert.notEqual(next.custom.key, old.custom.key);
            assert.equal(affiliate.profileForCustomer('C1').custom.key, next.custom.key);
        });
    });

    describe('attribution', function () {
        var code;
        beforeEach(function () { code = affiliate.join('C1').custom.key; });

        it('uses the referral link when nothing was entered at checkout', function () {
            var result = affiliate.resolve(basket(), code, { customerNo: 'C2', email: 'buyer@example.test' });
            assert.equal(result.code, code);
            assert.equal(result.source, 'LINK');
        });

        it('lets a code confirmed at checkout win over the link', function () {
            var other = affiliate.join('C3').custom.key;
            var result = affiliate.resolve(basket({ custom: { affiliateCode: other } }), code, { customerNo: 'C2' });
            assert.equal(result.code, other);
            assert.equal(result.source, 'CHECKOUT');
        });

        it('ignores the link once the shopper removed the referral', function () {
            assert.equal(affiliate.resolve(basket({ custom: { affiliateOptOut: true } }), code, { customerNo: 'C2' }), null);
        });

        it('rejects self-referral by account and by email', function () {
            assert.equal(affiliate.resolve(basket(), code, { customerNo: 'C1' }), null);
            assert.equal(affiliate.resolve(basket(), code, { customerNo: null, email: 'Referrer@Example.test' }), null);
        });

        it('ignores suspended affiliates', function () {
            affiliate.getProfile(code).custom.status = 'SUSPENDED';
            assert.equal(affiliate.resolve(basket(), code, { customerNo: 'C2' }), null);
        });

        it('allows only configured prepaid payment methods', function () {
            assert.equal(affiliate.prepaid(basket()), true);
            assert.equal(affiliate.prepaid(basket({ paymentInstruments: h.array([{ paymentMethod: 'COD' }]) })), false);
            assert.equal(affiliate.prepaid(basket({ paymentInstruments: h.array([]) })), false);
            h.preferences.AffiliatePrepaidPaymentMethods = ['COD'];
            assert.equal(affiliate.prepaid(basket({ paymentInstruments: h.array([{ paymentMethod: 'COD' }]) })), true);
        });

        it('snapshots only eligible lines, once per order', function () {
            var record = pendingRecord(code);
            affiliate.recordOrder(placedOrder('0001', code));
            assert.equal(record.custom.eligibleProductCount, 2);
            assert.equal(record.custom.eligibleOrderValue, 85000);
            assert.equal(record.custom.referrerCustomerNo, 'C1');
            assert.equal(record.custom.rewardStatus, 'PENDING');
            assert.equal(affiliate.getProfile(code).custom.totalOrders, 1);
        });
    });

    describe('rewards', function () {
        var code;
        var record;
        beforeEach(function () {
            code = affiliate.join('C1').custom.key;
            record = pendingRecord(code);
        });

        it('waits for payment and every shipment, and stops on cancellation or return', function () {
            var now = new Date();
            var order = h.order('0001', { paymentStatus: { value: h.Order.PAYMENT_STATUS_NOTPAID } });
            assert.equal(rewards.evaluate(order, record, now).reason, 'NOT_PAID');
            order = h.order('0001', { shippingStatus: { value: h.Order.SHIPPING_STATUS_NOTSHIPPED } });
            assert.equal(rewards.evaluate(order, record, now).reason, 'NOT_DELIVERED');
            var notShipped = { value: h.Order.SHIPPING_STATUS_NOTSHIPPED };
            var shipment = function (value) { return { shippingStatus: { value: value } }; };
            order = h.order('0001', { shippingStatus: notShipped, shipments: h.array([shipment(2), shipment(0)]) });
            assert.equal(rewards.evaluate(order, record, now).reason, 'NOT_DELIVERED');
            order = h.order('0001', { shippingStatus: notShipped, shipments: h.array([shipment(2), shipment(2)]) });
            assert.equal(rewards.evaluate(order, record, now).action, 'DELIVERED');
            order = h.order('0001', { status: { value: h.Order.ORDER_STATUS_CANCELLED } });
            assert.equal(rewards.evaluate(order, record, now).action, 'CANCELLED');
            order = h.order('0001', { returnCases: h.array([{}]) });
            assert.equal(rewards.evaluate(order, record, now).action, 'INELIGIBLE');
        });

        it('records delivery, then issues only after the return window', function () {
            var start = new Date();
            h.order('0001', { paymentStatus: { value: h.Order.PAYMENT_STATUS_NOTPAID } });
            rewards.advance(record, start);
            assert.equal(record.custom.reviewReason, 'NOT_PAID');
            h.order('0001');
            rewards.advance(record, start);
            assert.equal(record.custom.reviewReason, null);
            assert.equal(record.custom.deliveredAt, start);
            assert.equal(affiliate.getProfile(code).custom.totalDeliveredOrders, 1);
            rewards.advance(record, new Date(start.getTime() + DAY));
            assert.equal(record.custom.rewardStatus, 'PENDING');
            rewards.advance(record, new Date(start.getTime() + (8 * DAY)));
            assert.equal(record.custom.rewardStatus, 'ISSUED');
            var reward = h.db['AffiliateReward:0001:v1'];
            assert.equal(reward.custom.couponCode, 'AX10-K7P2Q9');
            assert.equal(reward.custom.rewardCustomerNo, 'C1');
            assert.equal(reward.custom.expiresAt.getTime() - reward.custom.issuedAt.getTime(), 30 * DAY);
            assert.equal(h.emails.length, 1);
            assert.equal(h.emails[0].to, 'referrer@example.test');
        });

        it('never issues twice for the same order', function () {
            record.custom.deliveredAt = new Date(Date.now() - (10 * DAY));
            h.order('0001');
            rewards.advance(record, new Date());
            record.custom.rewardStatus = 'PENDING';
            rewards.advance(record, new Date());
            var issued = Object.keys(h.db).filter(function (id) { return id.indexOf('AffiliateReward:') === 0; });
            assert.deepEqual(issued, ['AffiliateReward:0001:v1']);
            assert.equal(h.db['AffiliateReward:0001:v1'].custom.couponCode, 'AX10-K7P2Q9');
        });

        it('keeps the order pending when no coupon code is left', function () {
            record.custom.deliveredAt = new Date(Date.now() - (10 * DAY));
            h.order('0001');
            h.preferences.AffiliateRewardCouponID = 'missing';
            assert.throws(function () { rewards.advance(record, new Date()); }, /AFFILIATE_COUPON_UNAVAILABLE/);
            assert.equal(record.custom.rewardStatus, 'PENDING');
            assert.equal(h.db['AffiliateReward:0001:v1'], undefined);
        });

        it('marks orders below the minimum value ineligible', function () {
            record.custom.deliveredAt = new Date(Date.now() - (10 * DAY));
            h.order('0001');
            h.preferences.AffiliateMinimumOrderValue = 100000;
            rewards.advance(record, new Date());
            assert.equal(record.custom.rewardStatus, 'INELIGIBLE');
            assert.equal(record.custom.reviewReason, 'BELOW_MINIMUM');
        });
    });

    describe('vouchers', function () {
        var reward;
        beforeEach(function () {
            var record = pendingRecord(affiliate.join('C1').custom.key);
            record.custom.deliveredAt = new Date(Date.now() - (10 * DAY));
            h.order('0001');
            rewards.advance(record, new Date());
            reward = h.db['AffiliateReward:0001:v1'];
        });

        it('binds a voucher to the affiliate who earned it', function () {
            assert.equal(rewards.couponError(['ax10-k7p2q9'], 'C1'), null);
            assert.equal(rewards.couponError(['AX10-K7P2Q9'], 'C2'), 'error.voucher.owner');
            assert.equal(rewards.couponError(['AX10-K7P2Q9'], null), 'error.voucher.owner');
            assert.equal(rewards.couponError(['SUMMER'], null), null);
        });

        it('rejects expired, revoked and stacked vouchers', function () {
            h.db['AffiliateReward:0002:v1'] = { type: 'AffiliateReward', custom: { couponCode: 'AX10-M3R8T5', rewardCustomerNo: 'C1', status: 'ISSUED', expiresAt: new Date(Date.now() + DAY) } };
            assert.equal(rewards.couponError(['AX10-K7P2Q9', 'AX10-M3R8T5'], 'C1'), 'error.voucher.stacking');
            reward.custom.expiresAt = new Date(Date.now() - 1);
            assert.equal(rewards.couponError(['AX10-K7P2Q9'], 'C1'), 'error.voucher.unavailable');
            reward.custom.expiresAt = new Date(Date.now() + DAY);
            reward.custom.status = 'REVOKED';
            assert.equal(rewards.couponError(['AX10-K7P2Q9'], 'C1'), 'error.voucher.unavailable');
        });

        it('marks a voucher redeemed by the order that used it', function () {
            rewards.markRedeemed({ orderNo: '0009', couponLineItems: h.array([{ applied: true, couponCode: 'AX10-K7P2Q9' }]) });
            assert.equal(reward.custom.status, 'REDEEMED');
            assert.equal(reward.custom.redeemedOrderNo, '0009');
        });

        it('revokes a voucher when its source order is returned', function () {
            h.order('0001', { returnCases: h.array([{}]) });
            rewards.maintain(reward, new Date());
            assert.equal(reward.custom.status, 'REVOKED');
        });

        it('expires vouchers and reminds once before expiry', function () {
            rewards.maintain(reward, new Date(reward.custom.expiresAt.getTime() - (4 * DAY)));
            rewards.maintain(reward, new Date(reward.custom.expiresAt.getTime() - (3 * DAY)));
            assert.equal(h.emails.filter(function (e) { return e.template === 'affiliate/email/rewardExpiring'; }).length, 1);
            rewards.maintain(reward, new Date(reward.custom.expiresAt.getTime() + 1));
            assert.equal(reward.custom.status, 'EXPIRED');
        });

        it('retries a reward email that was not sent', function () {
            reward.custom.emailSentAt = null;
            rewards.maintain(reward, new Date());
            assert.ok(reward.custom.emailSentAt);
        });
    });
});
