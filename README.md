# BSI Digital Judge Report

Existing judge interface preserved: all 38 BSI breed entries, unlisted breeds,
assessment categories, validation, JSON/CSV export and Print / PDF remain.
The inherited mixed-language working risk summaries are preserved verbatim;
they are not approved official BSI wording. All new interface text is English.

## Organiser reporting extension

See [ORGANISER-MODULE.md](ORGANISER-MODULE.md) for the integrated club/show dashboard,
CSV/Excel ring import, access management, status exports and additive migration.
Apply organiser-schema.sql to the same D1 database before deploying this version.
New submissions require organising club type, regional ID or free-text club name,
and ring number; existing stored report content is retained.

## What works on GitHub Pages

- Complete draft report PDF download, generated locally in the browser.
- Administration/statistics preview at `admin.html`: click **Load demonstration data**.
  This is deliberately synthetic, not real SKK data.
- Any date range and breed selection; annual totals and per-area counts and
  percentages; missing assessments, sample sizes, descriptive annual changes.
- PDF and real OOXML Excel (.xlsx) exports, area CSV and SVG trend chart download.
- Optional judge email, unchecked consent and explicit disconnected-service state.

## Implemented backend (not connected by default)

- Server validation, Turnstile, rate limiting, size bounds and strict origins.
- D1 transaction saves an immutable report snapshot, structured risk assessments
  and one durable outbox entry per recipient. Requires an active SKK recipient.
- Unique submission keys + payload hashes prevent duplicate reports on double
  clicks and unchanged retries. A changed report is a new submission. Keys and
  receipt capabilities persist in the browser; report data and emails do not.
- Multiple SKK recipients and optional judge copy. All get the same saved PDF.
  Recipient list is snapshotted per report; later changes affect future reports.
- R2 private PDF storage; protected judge receipt and saved-PDF endpoints.
- Immediate background delivery and a five-minute scheduled outbox sweep.
  Atomic leases, exponential retry, stable Resend idempotency keys and event logs.
  Eight attempts maximum; attempts beyond the safe provider window are held as
  `uncertain` for operator review. No blind retries after acceptance or bounce.
- Signed, replay-safe Resend webhooks track delivery, bounce, complaint and failure.
- Cloudflare Access JWT validation (signature, issuer, audience, expiration),
  private manager/analyst allowlists, server-side roles and mutation origin checks.
- Manager-only recipient add/edit/disable, delivery monitor and audit history.
- Authenticated central statistics and exports; no public statistics API or
  recipient/email list. Free-text statistical notes need review before sharing.

## Activate services

Use organisation-owned Cloudflare and Resend accounts. No real collection or
email sending is enabled by this repository alone. No private addresses, live
secrets or personal report data should be committed here.

1. Install Node 24 and pnpm; run `pnpm install --frozen-lockfile`, `pnpm build`,
   `pnpm test`, and `pnpm exec wrangler deploy --dry-run`.
2. Create D1 (`pnpm exec wrangler d1 create bsi-reports`), set its ID in
   wrangler.toml and apply the additive schema:
   `pnpm exec wrangler d1 execute bsi-reports --remote --file=schema.sql`.
   Existing legacy `reports` records are preserved, but are not automatically
   relabelled or included in new statistics. Review and migrate historical data
   separately, with an explicit legacy version, before claiming complete coverage.
3. Create private R2 bucket `bsi-report-pdfs`. Do not enable a public R2 URL.
4. Configure a Turnstile widget for `callevys-create.github.io`. Store the secret
   with `pnpm exec wrangler secret put TURNSTILE_SECRET`.
5. Verify an organisation-controlled sending domain in Resend and set MAIL_FROM.
   Store a sending-only key using `pnpm exec wrangler secret put RESEND_API_KEY`.
6. Use an organisation-controlled backend hostname. Configure Cloudflare Access
   for `/admin*` and `/api/admin/*`, with named users and appropriate identity/MFA
   policies. Keep `/reports`, `/receipts/*` and `/webhooks/resend` publicly reachable;
   their own validations still apply. Set ACCESS_TEAM_DOMAIN and ACCESS_AUD.
   Do not protect the whole backend, which would block public judge submission.
7. Set private comma-separated allowlists with `wrangler secret put MANAGER_EMAILS`
   and `wrangler secret put ANALYST_EMAILS`. Analysts cannot manage recipients or
   inspect recipient delivery records. The backend never trusts an email header
   without a cryptographically verified Access token.
8. Deploy using `pnpm exec wrangler deploy`. Open the protected backend `/admin`
   page as a manager and add the approved SKK recipient addresses.
9. Configure Resend webhook URL `/webhooks/resend` for email.delivered,
   email.bounced, email.complained and email.failed. Set the signing secret using
   `pnpm exec wrangler secret put RESEND_WEBHOOK_SECRET`.
10. Publish privacy information (controller, processors, purpose, access, contact,
    retention, deletion), decide retention and backup/restore responsibilities,
    then set the public endpoint, Turnstile site key and privacy URL in config.js.
    Publish that file on GitHub Pages. Never put secrets in it.
11. Run a controlled live test: submit one report twice, verify one D1 report,
    correct recipient jobs, identical attached PDFs, saved-PDF download, actual
    inbox delivery, webhook status, failure recovery and role restrictions.

## Statistical definitions and limits

Concern % = (mild + clear + severe) / (none + mild + clear + severe) x 100.
Zero assessed denominator is **Not available**. Not assessed is excluded and
reported separately. Dogs judged means judging observations, not unique dogs.
Counts across risk areas, grading and placing can overlap and must not be summed
as unique affected dogs. No across-area “dogs with any concern” figure is invented.

Reports retain BSI version and exact risk text. Comparisons occur within the same
breed, risk and version, and only across consecutive observed years. Differences
are descriptive percentage-point changes and relative percentage changes; no
statistical significance or population-level health inference is claimed.
Partial-year date ranges are respected literally; compare like periods when
interpreting trends. Show identity currently uses normalised name + date +
country; a formal SKK show identifier remains a future data-quality improvement.

Statistics reads all matching records in pages, up to 10,000 reports per selection.
Larger selections explicitly require narrower dates/breed rather than truncating
results. For national multi-year scale, replace this bounded initial aggregation
with SQL aggregates and background export jobs before exceeding that limit.

Delivery monitor shows the latest 200 jobs. Automatic retention, a correction/
withdrawal workflow, public statistical release/redaction and a full operations
alerting dashboard are not implemented. Managers must investigate permanent and
uncertain deliveries in the provider dashboard; there is deliberately no unsafe
one-click re-send. Receipt keys act as confidential bearer capabilities.

## Tests

`pnpm test` uses real in-memory SQLite with the production schema, synthetic
reports, genuine PDF/XLSX generation, mocked mail/Turnstile/JWKS services and
signed JWT/webhook fixtures. It covers 38 breeds, validation, transactions,
duplicate handling, recipient copies, retries/leases, receipts, date ranges,
denominators, version boundaries, roles, CSRF and webhook replay.

Tests and browser demo exports do not prove live Cloudflare deployment or inbox
delivery. Test fixtures stay in ignored `.test-output/` and are never published.

## Third-party code and font

PDF generation: pdf-lib and fontkit. Excel packaging: fflate (OOXML text cells,
no formulas from user input). Authentication: jose. Webhook verification: svix.
Noto Sans font is distributed under the included FONT-LICENSE.txt.
Build dependencies are pinned in package.json and pnpm-lock.yaml.

References:
- https://developers.cloudflare.com/d1/worker-api/d1-database/
- https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/
- https://resend.com/docs/api-reference/emails/send-email
- https://resend.com/docs/webhooks/introduction
