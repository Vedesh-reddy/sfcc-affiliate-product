# Development phases

[← README](../README.md)

The working implementation is organized into five reviewable delivery phases. These branches describe the repository's packaging and review structure; they do not claim to reproduce the original chronological development history.

Each phase has a dedicated feature branch and PR targeting `main`. Phases are merged in order, keeping their branches and merge commits for reference.

| Phase | Feature branch | Scope | Pull request |
| --- | --- | --- | --- |
| 01 · Foundation | `feature/phase-01-foundation` | Cartridge identity, job step types, custom objects, attributes, preferences, jobs, coupon and promotion | [PR #1](https://github.com/Vedesh-reddy/sfcc-affiliate-product/pull/1) |
| 02 · Domain and jobs | `feature/phase-02-domain-jobs` | Identity, attribution, prepaid rule, reward engine, voucher rules, job steps, checkout wrapper, unit tests | [PR #2](https://github.com/Vedesh-reddy/sfcc-affiliate-product/pull/2) |
| 03 · Storefront | `feature/phase-03-storefront` | Controllers, login return slot, templates, overlays, browser module | [PR #3](https://github.com/Vedesh-reddy/sfcc-affiliate-product/pull/3) |
| 04 · Tooling and quality | `feature/phase-04-tooling-quality` | npm dependencies, build, lint checks, metadata ZIP, GitHub Actions, PR template, contributing guide | [PR #4](https://github.com/Vedesh-reddy/sfcc-affiliate-product/pull/4) |
| 05 · Documentation | `feature/phase-05-documentation` | Per-feature README with highlighted screenshots, guides, attribution | [PR #5](https://github.com/Vedesh-reddy/sfcc-affiliate-product/pull/5) |

The same cartridge is integrated in [SFCC-RefArch](https://github.com/Vedesh-reddy/SFCC-RefArch) through PRs #25–#28.

## Review order

1. Start with the metadata.
2. Then read `affiliateHelper.js` for identity and attribution, and `affiliateRewardHelper.js` for the reward state machine and voucher rules.
3. Next, the `PlaceOrder` and `AddCoupon` prepends and the `checkoutHelpers` wrapper.
4. Finish with the templates and browser code.

The screenshots follow each feature end to end.

The final `main` branch contains all five phases. Build output is generated locally or downloaded from a successful GitHub Actions run; it is not committed.
