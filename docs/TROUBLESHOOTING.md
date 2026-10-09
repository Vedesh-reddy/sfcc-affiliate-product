# Troubleshooting

[← README](../README.md) · [Installation](INSTALLATION.md)

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `Affiliate-Show` returns 404 | `AffiliateProgramEnabled` is off | Turn it on in the Affiliate Product preferences |
| `Type does not exist: AffiliateProfile` | Metadata not imported | Import `dist/affiliate-product-metadata.zip` |
| No Share & Earn link | Shopper not signed in, has no code, product has `affiliateExcluded`, or another cartridge overrides `socialIcons.isml` | Check each; merge the remote include into the other override |
| No checkout panel | Another cartridge overrides `checkout/orderProductSummary.isml` earlier in the path | Merge the panel include into that override |
| Copy button does nothing | `affiliate.js` not built or not uploaded | `npm run build` and upload `cartridge/static` |
| After login the shopper lands on My Account | Another cartridge reuses login slot `4` | Pick a free slot in `Affiliate.js` and the endpoint config |
| Referral stays "Awaiting delivery" | `reviewReason` says why: `NOT_PAID`, `NOT_DELIVERED`, `RETURN_WINDOW` or `AFFILIATE_INACTIVE` | Set Payment Status Paid and the shipment (or order) Shipping Status Shipped; wait `AffiliateRewardDelayDays` |
| Job ends with `ERROR` | A record failed; often `AFFILIATE_COUPON_UNAVAILABLE` | Check the `affiliate-product` log; set `AffiliateRewardCouponID`, enable the coupon, raise its code limit |
| Voucher shows no discount | Promotion or campaign disabled, or coupon not assigned | Check `affiliate-reward-10` in campaign `affiliate-rewards` |
| "Referred orders must be paid online" for a card | `CREDIT_CARD` not in `AffiliatePrepaidPaymentMethods` | Add the method ID or clear the preference |
| Page layout looks unstyled | Utility classes missing from the storefront CSS | The templates use utilities common to Bootstrap 4 and 5; check custom CSS builds |
