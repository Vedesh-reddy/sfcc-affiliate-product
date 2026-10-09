'use strict';

var CustomObjectMgr = require('dw/object/CustomObjectMgr');
var Transaction = require('dw/system/Transaction');
var Order = require('dw/order/Order');
var Logger = require('dw/system/Logger');
var affiliate = require('*/cartridge/scripts/helpers/affiliateHelper');

// Part of the reward key: changing the reward policy gets a new version so old orders never earn twice.
var POLICY_VERSION = 'v1';
var DAY = 86400000;

/**
 * @param {dw.order.Order} order - source order
 * @returns {boolean} true when the order was cancelled, failed or returned
 */
function voided(order) {
    if (!order) return true;
    var status = order.status.value;
    return status === Order.ORDER_STATUS_CANCELLED || status === Order.ORDER_STATUS_FAILED || order.returnCases.size() > 0;
}

/**
 * Business Manager and most OMS integrations set the status per shipment, others on the order.
 * @param {dw.order.Order} order - source order
 * @returns {boolean} true when the order, or every one of its shipments, is shipped
 */
function shipped(order) {
    if (order.shippingStatus.value === Order.SHIPPING_STATUS_SHIPPED) return true;
    var Shipment = require('dw/order/Shipment');
    var shipments = order.shipments.toArray();
    return shipments.length > 0 && shipments.every(function (shipment) {
        return shipment.shippingStatus.value === Shipment.SHIPPING_STATUS_SHIPPED;
    });
}

/**
 * Decides the next step for a pending referral order.
 * ponytail: "delivered" is the order, or all its shipments, reaching SHIPPED | upgrade path: store the carrier delivery date when the OMS sends one
 * @param {dw.order.Order} order - source order
 * @param {dw.object.CustomObject} record - AffiliateOrder
 * @param {Date} now - evaluation time
 * @returns {{action: string, reason: ?string}} WAIT, DELIVERED, CANCELLED, INELIGIBLE or ISSUE
 */
function evaluate(order, record, now) {
    if (!order || order.status.value === Order.ORDER_STATUS_CANCELLED || order.status.value === Order.ORDER_STATUS_FAILED) {
        return { action: 'CANCELLED', reason: 'ORDER_CANCELLED' };
    }
    if (order.returnCases.size() > 0) return { action: 'INELIGIBLE', reason: 'ORDER_RETURNED' };
    if (order.paymentStatus.value !== Order.PAYMENT_STATUS_PAID) return { action: 'WAIT', reason: 'NOT_PAID' };
    if (!shipped(order)) return { action: 'WAIT', reason: 'NOT_DELIVERED' };
    if (!record.custom.deliveredAt) return { action: 'DELIVERED', reason: null };
    if (now.getTime() < record.custom.deliveredAt.getTime() + (affiliate.pref('AffiliateRewardDelayDays') * DAY)) {
        return { action: 'WAIT', reason: 'RETURN_WINDOW' };
    }
    if (record.custom.eligibleOrderValue < affiliate.pref('AffiliateMinimumOrderValue')) {
        return { action: 'INELIGIBLE', reason: 'BELOW_MINIMUM' };
    }
    if (!affiliate.getActiveProfile(record.custom.affiliateCode)) return { action: 'WAIT', reason: 'AFFILIATE_INACTIVE' };
    return { action: 'ISSUE', reason: null };
}

/**
 * Creates the reward and allocates a native system-code coupon in one transaction.
 * The reward key is unique per order and policy, so retries and concurrent runs never issue twice.
 * @param {dw.object.CustomObject} record - AffiliateOrder
 * @param {Date} now - issue time
 * @returns {dw.object.CustomObject} the reward
 */
function issue(record, now) {
    var orderNo = record.custom.key;
    var reward = Transaction.wrap(function () {
        var key = orderNo + ':' + POLICY_VERSION;
        var existing = CustomObjectMgr.getCustomObject('AffiliateReward', key);
        if (!existing) {
            var coupon = require('dw/campaign/CouponMgr').getCoupon(affiliate.pref('AffiliateRewardCouponID'));
            var couponCode = coupon && coupon.enabled ? coupon.getNextCouponCode() : null;
            if (!couponCode) throw new Error('AFFILIATE_COUPON_UNAVAILABLE');
            existing = CustomObjectMgr.createCustomObject('AffiliateReward', key);
            existing.custom.affiliateCode = record.custom.affiliateCode;
            existing.custom.sourceOrderNo = orderNo;
            existing.custom.rewardCustomerNo = record.custom.referrerCustomerNo;
            existing.custom.couponCode = String(couponCode).toUpperCase();
            existing.custom.discountPercentage = affiliate.pref('AffiliateRewardPercent');
            existing.custom.status = 'ISSUED';
            existing.custom.issuedAt = now;
            existing.custom.expiresAt = new Date(now.getTime() + (affiliate.pref('AffiliateVoucherValidityDays') * DAY));
        }
        record.custom.rewardStatus = 'ISSUED';
        record.custom.rewardIssuedAt = now;
        return existing;
    });
    affiliate.count(record.custom.affiliateCode, 'totalRewards', null);
    Logger.getLogger('affiliate-product', 'affiliate-audit').info('Reward issued for order {0} to affiliate {1}', orderNo, record.custom.affiliateCode);
    return reward;
}

/**
 * Sends a reward email to the account's verified address and stamps the reward on success.
 * @param {dw.object.CustomObject} reward - AffiliateReward
 * @param {string} kind - 'earned' or 'expiring'
 * @returns {boolean} true when sent
 */
function sendEmail(reward, kind) {
    var customer = require('dw/customer/CustomerMgr').getCustomerByCustomerNumber(reward.custom.rewardCustomerNo);
    if (!customer || !customer.profile || !customer.profile.email) return false;
    var Resource = require('dw/web/Resource');
    var Site = require('dw/system/Site');
    require('*/cartridge/scripts/helpers/emailHelpers').send({
        to: customer.profile.email,
        from: Site.current.getCustomPreferenceValue('customerServiceEmail') || 'no-reply@salesforce.com',
        subject: Resource.msg('email.' + kind + '.subject', 'affiliate', null)
    }, kind === 'earned' ? 'affiliate/email/rewardEarned' : 'affiliate/email/rewardExpiring', {
        firstName: customer.profile.firstName,
        couponCode: reward.custom.couponCode,
        percent: reward.custom.discountPercentage,
        expiresAt: reward.custom.expiresAt,
        dashboardUrl: require('dw/web/URLUtils').https('Affiliate-Dashboard').toString()
    });
    Transaction.wrap(function () {
        reward.custom[kind === 'earned' ? 'emailSentAt' : 'reminderSentAt'] = new Date();
    });
    return true;
}

/**
 * Moves one pending referral order forward. Called by the reward job.
 * @param {dw.object.CustomObject} record - AffiliateOrder with rewardStatus PENDING
 * @param {Date} now - evaluation time
 */
function advance(record, now) {
    var order = require('dw/order/OrderMgr').getOrder(record.custom.key);
    var decision = evaluate(order, record, now);
    if (decision.action === 'WAIT') {
        // Shows merchants in Business Manager why a reward is still pending.
        if (record.custom.reviewReason !== decision.reason) {
            Transaction.wrap(function () { record.custom.reviewReason = decision.reason; });
        }
        return;
    }
    if (decision.action === 'DELIVERED') {
        Transaction.wrap(function () {
            record.custom.deliveredAt = now;
            record.custom.reviewReason = null;
        });
        affiliate.count(record.custom.affiliateCode, 'totalDeliveredOrders', 'deliveredOrders');
        return;
    }
    if (decision.action === 'ISSUE') {
        // Email is sent after the issuing transaction commits; the maintenance job retries it if this fails.
        sendEmail(issue(record, now), 'earned');
        return;
    }
    Transaction.wrap(function () {
        record.custom.rewardStatus = decision.action;
        record.custom.reviewReason = decision.reason;
    });
}

/**
 * Expires, revokes or reminds one issued reward. Called by the maintenance job.
 * ponytail: a voucher already redeemed is not clawed back when its source order is returned later | upgrade path: finance asks for clawback
 * @param {dw.object.CustomObject} reward - AffiliateReward with status ISSUED
 * @param {Date} now - evaluation time
 */
function maintain(reward, now) {
    var next = null;
    if (voided(require('dw/order/OrderMgr').getOrder(reward.custom.sourceOrderNo))) next = 'REVOKED';
    else if (reward.custom.expiresAt.getTime() <= now.getTime()) next = 'EXPIRED';
    if (next) {
        Transaction.wrap(function () { reward.custom.status = next; });
        Logger.getLogger('affiliate-product', 'affiliate-audit').info('Reward {0} for order {1}', next, reward.custom.sourceOrderNo);
        return;
    }
    if (!reward.custom.emailSentAt) {
        sendEmail(reward, 'earned');
    } else if (!reward.custom.reminderSentAt
        && reward.custom.expiresAt.getTime() - (affiliate.pref('AffiliateExpiryReminderDays') * DAY) <= now.getTime()) {
        sendEmail(reward, 'expiring');
    }
}

/**
 * @param {string} couponCode - coupon code
 * @returns {dw.object.CustomObject|null} the reward that owns the code
 */
function findByCoupon(couponCode) {
    var code = String(couponCode || '').trim().toUpperCase();
    return code ? affiliate.query('AffiliateReward', 'custom.couponCode = {0}', [code], 1)[0] || null : null;
}

/**
 * Server-side voucher rules: only the owner may use it, only while issued and unexpired,
 * and only one affiliate voucher per order.
 * @param {string[]} couponCodes - codes in the basket, including one being added
 * @param {?string} customerNo - authenticated customer number
 * @returns {string|null} resource key of the violated rule
 */
function couponError(couponCodes, customerNo) {
    var rewards = couponCodes.map(findByCoupon).filter(Boolean);
    if (rewards.length > 1) return 'error.voucher.stacking';
    var reward = rewards[0];
    if (!reward) return null;
    if (!customerNo || reward.custom.rewardCustomerNo !== customerNo) return 'error.voucher.owner';
    if (reward.custom.status !== 'ISSUED' || reward.custom.expiresAt.getTime() <= Date.now()) return 'error.voucher.unavailable';
    return null;
}

/**
 * Marks affiliate vouchers used by a placed order as redeemed. The native coupon
 * redemption limit (1 per code) is what blocks a second use; this keeps the wallet in step.
 * @param {dw.order.Order} order - placed order
 */
function markRedeemed(order) {
    order.couponLineItems.toArray().forEach(function (line) {
        var reward = line.applied ? findByCoupon(line.couponCode) : null;
        if (reward && reward.custom.status === 'ISSUED') {
            Transaction.wrap(function () {
                reward.custom.status = 'REDEEMED';
                reward.custom.redeemedOrderNo = order.orderNo;
            });
        }
    });
}

module.exports = {
    evaluate: evaluate,
    issue: issue,
    advance: advance,
    maintain: maintain,
    findByCoupon: findByCoupon,
    couponError: couponError,
    markRedeemed: markRedeemed
};
