# Testing and validation

[← README](../README.md) · [Code reference](CODE-REFERENCE.md)

## Repeatable local checks

```sh
npm ci
npm run validate          # lint (JS, ISML, docs links) + tests + build
npm run package:metadata  # dist/affiliate-product-metadata.zip
```

CI runs the same on Node 22 and 24 for every push and pull request.

## Unit tests (23)

`test/unit/plugin_affiliateproduct/harness.js` is a small in-memory Script API double. It provides unique custom object keys, transaction rollback, coupons with a finite code pool, orders with shipments, and mail capture.

| Area | Covers |
| --- | --- |
| Identity | Alphabet and length, input normalization, same code on repeated joins, collision retry, rotation |
| Attribution | Link attribution, checkout code over link, opt-out, self-referral by account and email, suspended affiliates, prepaid methods, eligible-line snapshot written once |
| Rewards | Payment and delivery waits (order or every shipment), cancellation, return cases, delivery then return window, single issuance on retry, coupon exhaustion rollback, minimum value |
| Vouchers | Ownership, guests, expiry, revocation, stacking, redemption, revocation on return, one reminder, email retry |

## Sandbox checks behind the screenshots

Performed on sandbox `zyeu-002`, site `RefArch_Practice`, October 9, 2026. Two shoppers registered through the storefront; a headless browser drove every step.

| Check | Result |
| --- | --- |
| Anonymous program page → sign in via `rurl=4` | Returned to the program page |
| Generate, reload | Same code `5WDKXWDR`; copy button reported success |
| Product page signed in as affiliate | Share & Earn link with `?aff=5WDKXWDR` |
| Product with `affiliateExcluded` | No link |
| Link opened by another shopper | Notice shown; click counted once; checkout showed "From the referral link" |
| Remove; unknown code; valid code | Link ignored; "not valid"; "Entered at checkout" |
| Affiliate enters own code; 10 more attempts | Rejected; attempt limit message |
| Referred order 00000301 | `AffiliateOrder` PENDING (`NOT_PAID`, then `NOT_DELIVERED`) |
| 00000301 Paid, shipment Shipped; job twice | Delivery recorded, voucher `AX10-VVBX-DKHB-4VBW-N52H` issued once |
| Referred order 00000304 cancelled; job | `Cancelled`, no voucher |
| `AffiliatePrepaidPaymentMethods = COD`, referred card order | Place order refused with the prepaid message |
| Voucher in another account's cart | Refused: belongs to another account |
| Voucher in the owner's cart, order 00000306 | 10% order discount; voucher `Redeemed` |
| Same voucher again | Refused: expired or already used |

Not exercised live: voucher expiry and the reminder email (unit tests cover both), and the reward email content, because the test accounts used `example.com` addresses.

## Defects found on the sandbox and fixed

| Symptom | Cause | Fix |
| --- | --- | --- |
| Dashboard numbers shown as `0.0` | ISML formats JS numbers with decimals | Numbers passed as strings |
| Referral stuck at `NOT_DELIVERED` although the shipment was Shipped | Business Manager sets shipping status per shipment | Delivered when the order **or every shipment** is Shipped |
| No way to see why a referral waits | — | `AffiliateOrder.reviewReason` stores the wait reason |
| Layout broken on the sandbox | Its SFRA base still ships Bootstrap 4 CSS | Utilities that exist in both Bootstrap 4 and 5 |
