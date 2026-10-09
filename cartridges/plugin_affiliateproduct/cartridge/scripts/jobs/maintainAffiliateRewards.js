'use strict';

var Status = require('dw/system/Status');
var Logger = require('dw/system/Logger');
var affiliate = require('*/cartridge/scripts/helpers/affiliateHelper');
var rewards = require('*/cartridge/scripts/helpers/affiliateRewardHelper');

/**
 * Revokes vouchers whose source order was returned or cancelled, expires old ones,
 * retries failed reward emails and sends expiry reminders.
 * @returns {dw.system.Status} OK, or ERROR when any reward failed and needs a retry
 */
function execute() {
    var logger = Logger.getLogger('affiliate-product', 'affiliate-rewards');
    var now = new Date();
    var failures = 0;
    affiliate.query('AffiliateReward', 'custom.status = {0}', ['ISSUED'], 2000, 'creationDate asc').forEach(function (reward) {
        try {
            rewards.maintain(reward, now);
        } catch (e) {
            failures += 1;
            logger.error('Reward maintenance failed for order {0}: {1}', reward.custom.sourceOrderNo, e.message);
        }
    });
    return failures ? new Status(Status.ERROR, 'ERROR', failures + ' rewards failed') : new Status(Status.OK, 'OK');
}

module.exports = { execute: execute };
