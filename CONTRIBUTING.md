# Contributing

Start from `main` and create a focused `feature/`, `fix/`, or `docs/` branch. Keep behavior changes and documentation accurate together.

```sh
npm ci
npm run validate
npm run package:metadata
```

CI mocks cannot validate order placement, coupon code allocation, promotions, mail delivery, remote includes or metadata installation. For a platform behavior change, exercise the affected feature on a sandbox, following the sandbox checks in [docs/TESTING.md](docs/TESTING.md). In the PR, say which checks were automated and which were manual.

Preserve these rules:

- one affiliate identity per customer, enforced by the `AffiliateCustomerIndex` key;
- one reward per order, enforced by the `orderNo:version` reward key; bump the version when the reward policy changes;
- vouchers are checked against the authenticated owner on the server, at add-to-cart and at place order;
- every storefront post validates CSRF;
- custom object iterators are closed in `finally`, and storefront requests never run unbounded queries;
- affiliates never see buyer personal data.

Keep credentials and generated output out of Git. Add new attributes to both the metadata and the installation guide, and new text to `affiliate.properties`.

See [NOTICE.md](NOTICE.md) for attribution and terms.
