# Installation

[← README](../README.md) · [Merchant guide](MERCHANT-GUIDE.md) · [Troubleshooting](TROUBLESHOOTING.md)

## Requirements

- An SFRA storefront (`app_storefront_base`) on Salesforce B2C Commerce.
- Node.js 22 or later to build and test.
- Business Manager access to import a site archive, edit the cartridge path, content assets and jobs.

## 1. Build

```sh
npm ci
npm run validate          # lint, 23 unit tests, builds cartridge/static/default/js/affiliate.js
npm run package:metadata  # dist/affiliate-product-metadata.zip
```

## 2. Deploy the cartridge

Upload `cartridges/plugin_affiliateproduct`, including the generated `cartridge/static`, to your code version with your usual tool, for example:

```sh
npx sgmf-scripts --uploadCartridge plugin_affiliateproduct
```

`dw.example.json` shows the expected `dw.json` fields. Keep `dw.json` out of Git.

## 3. Cartridge path

**Administration → Sites → Manage Sites → your site → Settings**: put the cartridge first.

```text
plugin_affiliateproduct:app_storefront_base
```

With other overlays, keep `plugin_affiliateproduct` leftmost. Its overlays chain to the next cartridge through `module.superModule`:

- `Cart`, `Checkout` and `CheckoutServices` controllers;
- `checkoutHelpers`;
- `config/oAuthRenentryRedirectEndpoints`.

If another cartridge already uses login return slot `4`, change `LOGIN_RETURN` in `controllers/Affiliate.js` and the slot in the endpoint config.

Two SFRA templates are overlaid, each a copy with one include added:

- `product/components/socialIcons.isml`
- `checkout/orderProductSummary.isml`

If another cartridge overrides either one, merge the include into that copy.

## 4. Import metadata

The archive `metadata/affiliate-product` contains:

| File | Contents |
| --- | --- |
| `meta/custom-objecttype-definitions.xml` | `AffiliateProfile`, `AffiliateCustomerIndex`, `AffiliateOrder`, `AffiliateReward`, `AffiliateDailyStats` |
| `meta/system-objecttype-extensions.xml` | Product `affiliateExcluded`; Basket `affiliateCode`, `affiliateSource`, `affiliateOptOut`; Order `affiliateCode`, `affiliateSource`; the **Affiliate Product** site preferences |
| `jobs.xml` | `AffiliateProduct-ProcessRewards`, `AffiliateProduct-MaintainRewards` |
| `sites/RefArch/preferences.xml` | Program on, coupon ID `affiliate-reward` |
| `sites/RefArch/coupons.xml` | Coupon `affiliate-reward`: system codes, prefix `AX10`, case-insensitive, 1 redemption per code, no multiple codes per order |
| `sites/RefArch/promotions.xml` | Campaign `affiliate-rewards`, promotion `affiliate-reward-10` (10% off the order), coupon-qualified |

1. Rename `sites/RefArch` to your site ID and set `site-id` in `jobs.xml`.
2. `npm run package:metadata`.
3. **Administration → Site Development → Site Import & Export**: upload and import `dist/affiliate-product-metadata.zip`.

To discount products instead of the order, or to cap the discount, edit the promotion in **Merchant Tools → Online Marketing → Promotions**. Its exclusions are the place to keep categories out of the discount.

## 5. Footer link

**Merchant Tools → Content → Content Assets → `footer-account`**: add

```html
<li><a href="$url('Affiliate-Show')$">Affiliate Program</a></li>
```

## 6. Jobs

**Administration → Operations → Jobs**:

| Job | Schedule | Purpose |
| --- | --- | --- |
| `AffiliateProduct-ProcessRewards` | Every 30 minutes | Records delivery, waits out the return window, issues vouchers |
| `AffiliateProduct-MaintainRewards` | Daily | Revokes, expires, retries emails, sends expiry reminders |

## 7. Check

1. Open `Affiliate-Show`, sign in and generate a code.
2. Open an eligible product: the Share & Earn link appears.
3. Open that link in a private window, add to cart and check out: the order summary shows the referral.
4. Set the order to Paid and its shipment to Shipped, then run `AffiliateProduct-ProcessRewards`:
   - the first run records delivery;
   - after `AffiliateRewardDelayDays`, a later run issues the voucher.
