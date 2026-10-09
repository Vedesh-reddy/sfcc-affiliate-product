# Merchant guide

[← README](../README.md) · [Installation](INSTALLATION.md)

## Site preferences

**Merchant Tools → Site Preferences → Custom Preferences → Affiliate Product**

| Preference | Default | Effect |
| --- | --- | --- |
| `AffiliateProgramEnabled` | false | Switches every route, include and checkout check on or off |
| `AffiliateRewardCouponID` | — | System-codes coupon that supplies voucher codes |
| `AffiliateRewardPercent` | 10 | Percentage shown to shoppers; the promotion applies the discount |
| `AffiliateVoucherValidityDays` | 30 | Voucher lifetime from issue |
| `AffiliateAttributionWindowDays` | 30 | How long a referral link is remembered |
| `AffiliateRewardDelayDays` | 7 | Return window after delivery before a voucher is issued |
| `AffiliateMinimumOrderValue` | 0 | Minimum eligible value of a referred order |
| `AffiliatePrepaidPaymentMethods` | `CREDIT_CARD` | Payment method IDs a referred order may use |
| `AffiliateExpiryReminderDays` | 5 | Days before expiry to send one reminder |

Keep `AffiliateRewardPercent` equal to the promotion's percentage.

## Products

Set **Affiliate Product → `affiliateExcluded`** on a product to remove its Share & Earn link and leave its lines out of the eligible value. Variants inherit the master's value.

## Jobs

| Job | What to expect |
| --- | --- |
| `AffiliateProduct-ProcessRewards` | Handles up to 500 pending orders per run, oldest first. Status `ERROR` means at least one order failed; its error is in the `affiliate-product` log. |
| `AffiliateProduct-MaintainRewards` | Handles up to 2,000 issued vouchers per run. |

When the coupon runs out of codes, issuance fails with `AFFILIATE_COUPON_UNAVAILABLE` and orders stay pending. Raise the coupon's maximum number of codes.

## Custom objects

**Merchant Tools → Custom Objects → Custom Object Editor**

| Type | Use it to |
| --- | --- |
| `AffiliateProfile` | See an affiliate's totals. Set `status` to `SUSPENDED` to stop new rewards, or `ROTATED` to issue a new code on their next visit. |
| `AffiliateOrder` | See a referral's `rewardStatus` and `reviewReason` (`NOT_PAID`, `NOT_DELIVERED`, `RETURN_WINDOW`, `AFFILIATE_INACTIVE`, `ORDER_RETURNED`, `BELOW_MINIMUM`). |
| `AffiliateReward` | See a voucher's owner, code, status (`ISSUED`, `REDEEMED`, `EXPIRED`, `REVOKED`), expiry and redeeming order. |
| `AffiliateDailyStats` | Daily clicks, orders and deliveries per code. Deleted after 400 days. |

Do not edit `AffiliateCustomerIndex`; it guarantees one code per customer.

## Orders

A referred order carries `affiliateCode` and `affiliateSource` (`LINK` or `CHECKOUT`) in its custom attributes.

| Order state | Reward result |
| --- | --- |
| Cancelled or failed | Cancelled |
| Has a return case | Not eligible; an issued, unused voucher is revoked |
| Paid, and the order or every shipment Shipped | Delivery recorded; the voucher follows after the return window |

A voucher that was already used is not taken back automatically if its source order is returned later.
