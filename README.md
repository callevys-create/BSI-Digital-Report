# BSI Digital Report

Working prototype, not an official FCI form. The existing 38 breed entries,
unlisted-breed choice and working risk summaries are preserved.

## Current status

GitHub Pages supports exports, optional judge email and an unchecked
“Send me a copy of my completed BSI report” checkbox. Submission is disabled
until `config.js` contains a backend URL, public Turnstile site key and privacy URL.
No email is sent in this default state. Email is excluded from exports.

## Activate real submission and email

An administrator needs Cloudflare Workers/D1/Turnstile and a Resend account
with a verified sending domain. Never commit secrets or enter them in config.js.

1. In the repository folder, create a D1 database (`npx wrangler d1 create bsi-reports`).
   Insert its ID in wrangler.toml; apply schema.sql using
   `npx wrangler d1 execute bsi-reports --remote --file=schema.sql`.
2. Create a Turnstile widget allowing callevys-create.github.io. Set secrets using
   `npx wrangler secret put TURNSTILE_SECRET` and
   `npx wrangler secret put RESEND_API_KEY`. Use a sending-only Resend key.
3. Set MAIL_FROM to the verified sender, review the rate limit, and deploy using
   `npx wrangler deploy`. The endpoint is https://YOUR-WORKER.workers.dev/reports.
4. Before enabling collection, publish privacy information identifying the report
   operator, Cloudflare/Resend processing, contact, purpose and retention schedule.
   Configure access controls and deletion for D1 reports; this prototype does not
   include a committee dashboard or automatic retention job. Email is passed to
   Resend only on opt-in, never stored in D1. Resend may retain recipient/log data.
5. Update public config.js with endpoint, site key and privacy URL, then publish
   these static files on the existing GitHub Pages branch.
6. With a test report and an address you control, test unchecked/checked consent,
   missing/invalid email, expired verification, duplicate clicks, service failure,
   D1 persistence, email contents, and actual inbox delivery. Confirm all breed
   choices and risk totals and test on mobile.

Backend validates counts and breed risk rows, verifies Turnstile on the server,
restricts origin, bounds request size and rate limits. Reports are stored before
sending a plain-text copy of the complete report through Resend. No recipient,
subject or sender supplied by the client can override the fixed mail template.
Provider acceptance is not confirmed inbox delivery. Email failure leaves the
report stored and the UI explains how to save a copy. A lost response can leave
submission uncertain: export first, avoid blindly resubmitting. No automatic
retries or claim of exactly-once submission are provided.

## Verification

Run `node --test worker.test.mjs` (Node 22+). Tests use mocked providers;
passing tests do not constitute a live email delivery test.

References: https://resend.com/docs/api-reference/emails/send-email
and https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
