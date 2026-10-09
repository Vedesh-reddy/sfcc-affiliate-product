# Architecture

[← README](../README.md) · [Code reference](CODE-REFERENCE.md)

## Principles

- **Overlay only.** No SFRA file is edited. Controllers extend base routes with `server.append` / `server.prepend`; `checkoutHelpers` and the login endpoint map wrap `module.superModule`; two templates are SFRA copies with one include each.
- **Native commerce records stay authoritative.** Orders carry the attribution; a native system-codes coupon and promotion apply the discount and enforce single use. Custom objects track ownership and lifecycle only.
- **No unbounded storefront queries.** Storefront requests read by primary key; dashboard lists and jobs read bounded pages and close iterators in `finally`.

## Request flows

```text
Product page (cached)
  └─ socialIcons.isml ─ remote include ─> Affiliate-Share (uncached)
        ├─ ?aff=CODE valid → count click once per session, set cookie affiliate-ref, show notice
        └─ signed-in affiliate, product not excluded → Share & Earn link

Checkout-Begin (append) → affiliateCheckout view data → orderProductSummary.isml → checkout panel
AffiliateReferral-Apply / -Remove (AJAX, CSRF) → basket.affiliateCode / affiliateOptOut → re-rendered panel

CheckoutServices-PlaceOrder (prepend)
  ├─ affiliate vouchers in basket: owner, ISSUED, unexpired, at most one
  ├─ attribution: checkout code > link cookie (unless opted out), active, not self, ≥1 eligible line
  ├─ referred + non-prepaid payment → refuse with message
  └─ write basket.affiliateCode / affiliateSource
checkoutHelpers.createOrder → copy attribution to the order
checkoutHelpers.placeOrder  → AffiliateOrder snapshot (PENDING) + mark used vouchers REDEEMED

Cart-AddCoupon (prepend) → same voucher rules before the base route adds the coupon
```

## Reward state machine

```text
AffiliateOrder PENDING
  ├─ order cancelled/failed ───────────────→ CANCELLED
  ├─ return case ──────────────────────────→ INELIGIBLE (ORDER_RETURNED)
  ├─ not paid / not shipped ───────────────→ stays PENDING, reviewReason set
  ├─ first seen shipped ───────────────────→ deliveredAt recorded
  ├─ inside return window ─────────────────→ PENDING (RETURN_WINDOW)
  ├─ below minimum value ──────────────────→ INELIGIBLE (BELOW_MINIMUM)
  ├─ affiliate not ACTIVE ─────────────────→ PENDING (AFFILIATE_INACTIVE)
  └─ otherwise ────────────────────────────→ ISSUED + AffiliateReward ISSUED + email

AffiliateReward ISSUED
  ├─ source order cancelled or returned ───→ REVOKED
  ├─ past expiresAt ───────────────────────→ EXPIRED
  ├─ used in an order ─────────────────────→ REDEEMED
  └─ email missing → retry; near expiry → one reminder
```

## Data model

| Type | Key | Written by | Read by |
| --- | --- | --- | --- |
| `AffiliateProfile` | code | join, counters, merchant | every route, jobs |
| `AffiliateCustomerIndex` | customer number | join | profile lookup |
| `AffiliateOrder` | order number | placeOrder, reward job | reward job, dashboard |
| `AffiliateReward` | `orderNo:v1` | reward job, placeOrder, maintenance job | voucher checks, dashboard |
| `AffiliateDailyStats` | `code:YYYY-MM-DD` | click, order, delivery counters | dashboard |

## Concurrency and idempotency

- **One identity per customer.** The index and the profile are created in one transaction. A second concurrent join fails on the index key, rolls back its own profile, and the retry returns the first profile. Code collisions are retried up to five times.
- **One reward per order.** The reward key `orderNo:v1` is unique. The coupon code is allocated (`getNextCouponCode`) in the same transaction, so a failed run leaves neither a reward nor a consumed code. A re-run finds the existing reward and only fixes the order status. Changing the reward policy means a new version suffix.
- **Email after commit.** Emails are sent outside the transaction and stamped on success; the maintenance job retries unsent ones.
- **Single use.** Enforced by the coupon's native limit of one redemption per code at order placement.
- **Counters** (`totalClicks`, daily stats) are best effort and last-write-wins.

## Security and privacy

- Every POST validates CSRF. Voucher ownership is checked server-side against the authenticated customer number, at add-to-cart and again at place order.
- The referral cookie is HttpOnly and Secure and holds only a public code and a timestamp. A tampered cookie can only name another valid code, as typing it at checkout would.
- Code attempts are capped at 10 per session.
- Affiliates see referred orders as `••••` plus the last four digits, with date, eligible value and status. No buyer name, email or address is exposed or stored; `AffiliateOrder` keeps only the buyer's customer number.
- Logs use `Logger.getLogger('affiliate-product', <category>)`: `affiliate-identity`, `affiliate-stats`, `referral-attribution`, `affiliate-rewards`, `affiliate-audit`. Logs record order numbers and affiliate codes, never emails or payment data.
