# Code reference

[← README](../README.md) · [Architecture](ARCHITECTURE.md) · [Testing](TESTING.md)

All paths are under `cartridges/plugin_affiliateproduct/cartridge`.

## Controller routes

| Route | Method | Middleware | Behavior |
| --- | --- | --- | --- |
| `Affiliate-Show` | GET | HTTPS, program on, CSRF token | Program page; code, generate button or sign-in link (`Login-Show?rurl=4`) |
| `Affiliate-Generate` | POST | HTTPS, program on, logged in, CSRF | Creates or returns the customer's code; redirects to `Affiliate-Show` |
| `Affiliate-Share` | GET | Remote include only, program on | Uncached; counts a referral click, sets the cookie, renders the notice and Share & Earn link |
| `Affiliate-Dashboard` | GET | HTTPS, program on, logged in | Totals, code, six-month table, last 20 referral orders and vouchers |
| `AffiliateReferral-Apply` | POST | HTTPS, AJAX CSRF | Validates and stores a checkout code; JSON with the re-rendered panel or an error |
| `AffiliateReferral-Remove` | POST | HTTPS, AJAX CSRF | Removes the referral and opts the basket out of the link |
| `Checkout-Begin` | append | — | Adds `affiliateCheckout` view data |
| `CheckoutServices-PlaceOrder` | prepend | — | Voucher rules, final attribution, prepaid rule |
| `Cart-AddCoupon` | prepend | — | Voucher rules before the base route adds the coupon |

When `AffiliateProgramEnabled` is off, the `Affiliate-*` routes answer 404 and the extensions do nothing.

## Script modules

### `scripts/helpers/affiliateHelper.js`

| Export | Purpose |
| --- | --- |
| `pref(name)` | Site preference with the documented default |
| `enabled()` | Program switch |
| `normalize(value)` | Upper-cases and validates an 8-character code; `null` otherwise |
| `generateCode()` | Random code from `23456789ABCDEFGHJKLMNPQRSTUVWXYZ` |
| `getProfile(code)` / `getActiveProfile(code)` / `profileForCustomer(customerNo)` | Key lookups |
| `join(customerNo)` | Returns or creates the customer's profile; retries on collisions and concurrent joins |
| `count(code, profileField, statsField)` | Best-effort counters in their own transaction |
| `rememberReferral(code, response)` / `referralFromCookie(request)` | Cookie `affiliate-ref` within the attribution window |
| `isSelfReferral(profile, shopper)` | Same customer number or same email |
| `resolve(basket, linkCode, shopper)` | Attribution policy: opt-out, checkout code, then link |
| `buyer(req, basket)` / `checkoutView(basket, req)` | Shopper identity; panel data |
| `eligibleLines(container)` | Lines whose product is not `affiliateExcluded` |
| `prepaid(container)` | Every payment instrument is an allowed method |
| `recordOrder(order)` | Creates the `AffiliateOrder` snapshot once |
| `query(type, condition, args, limit, sort)` | Bounded custom object query; closes the iterator |

### `scripts/helpers/affiliateRewardHelper.js`

| Export | Purpose |
| --- | --- |
| `evaluate(order, record, now)` | Pure decision: `WAIT`, `DELIVERED`, `CANCELLED`, `INELIGIBLE` or `ISSUE`, with a reason |
| `advance(record, now)` | Applies the decision; stores the wait reason |
| `issue(record, now)` | Idempotent reward plus coupon code in one transaction |
| `maintain(reward, now)` | Revoke, expire, retry email, remind |
| `findByCoupon(code)` | Reward owning a coupon code |
| `couponError(codes, customerNo)` | Resource key of a broken voucher rule, or `null` |
| `markRedeemed(order)` | Marks used affiliate vouchers redeemed |

### `scripts/checkout/checkoutHelpers.js`

Wraps the next `checkoutHelpers` in the path:

- `createOrder` copies `affiliateCode` and `affiliateSource` from the basket to the order;
- `placeOrder` records the snapshot and redemptions after a successful placement. Failures there are logged and never fail the order.

### `config/oAuthRenentryRedirectEndpoints.js`

Adds login return slot `4` → `Affiliate-Show` to the inherited map.

## Job steps

| Step type | Module | Function |
| --- | --- | --- |
| `custom.AffiliateProduct.ProcessRewards` | `scripts/jobs/processAffiliateRewards.js` | `execute` — up to 500 `PENDING` orders, oldest first |
| `custom.AffiliateProduct.MaintainRewards` | `scripts/jobs/maintainAffiliateRewards.js` | `execute` — up to 2,000 `ISSUED` vouchers |

Both are `transactional: false` and return `ERROR` when any record failed.

## Templates

| Template | Rendered by |
| --- | --- |
| `affiliate/landing.isml` | `Affiliate-Show` |
| `affiliate/dashboard.isml` | `Affiliate-Dashboard` |
| `affiliate/share.isml` | `Affiliate-Share` |
| `affiliate/checkoutPanel.isml` | `orderProductSummary.isml` and the referral routes |
| `affiliate/email/rewardEarned.isml`, `rewardExpiring.isml` | Reward emails |
| `product/components/socialIcons.isml` | SFRA copy + `Affiliate-Share` remote include |
| `checkout/orderProductSummary.isml` | SFRA copy + checkout panel when `affiliateCheckout` is set |

Text lives in `templates/resources/affiliate.properties`. The templates use Bootstrap utilities that exist in both Bootstrap 4 and 5.

## Browser module

`client/default/js/affiliate.js` (built to `static/default/js/affiliate.js`) handles:

- copy buttons (`data-affiliate-copy`), with feedback in an `aria-live` region;
- the checkout panel forms, which it posts as `application/x-www-form-urlencoded` and then swaps in the returned panel.
