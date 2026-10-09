'use strict';

var Status = require('dw/system/Status');
var Logger = require('dw/system/Logger');
var affiliate = require('*/cartridge/scripts/helpers/affiliateHelper');
var rewards = require('*/cartridge/scripts/helpers/affiliateRewardHelper');

/**
 * Moves pending referral orders towards a reward: records delivery, waits out the
 * return window, then issues one voucher per qualifying order.
 * @returns {dw.system.Status} OK, or ERROR when any order failed and needs a retry
 */
function execute() {
    var logger = Logger.getLogger('affiliate-product', 'affiliate-rewards');
    var now = new Date();
    var failures = 0;
    // Oldest first, bounded per run; the 30-minute schedule drains any backlog.
    affiliate.query('AffiliateOrder', 'custom.rewardStatus = {0}', ['PENDING'], 500, 'creationDate asc').forEach(function (record) {
        try {
            rewards.advance(record, now);
        } catch (e) {
            failures += 1;
            logger.error('Reward processing failed for order {0}: {1}', record.custom.key, e.message);
        }
    });
    return failures ? new Status(Status.ERROR, 'ERROR', failures + ' orders failed') : new Status(Status.OK, 'OK');
}

module.exports = { execute: execute };
