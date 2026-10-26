# Organiser reporting module

This module extends the existing BSI application and the SAME Cloudflare D1
binding (`DB`). It does not create another submission system, report database,
or email distribution path. The existing `submissions` row is the source of
truth; `report_links` contains only its effective club/show/ring association.

## Public test mode

Open `organiser.html`, choose **Load demonstration data**, then select the
regional club view or SKK manager view. The regional demo is limited to
Stockholms Kennelklubb; SKK can see the synthetic cross-club overview. Preview
changes live in the tab only and disappear on reload. No real submission is
created and no email is sent. The demo uses the same matching/calculation and
import code as the backend, but demonstrates permissions rather than replacing
server authentication.

The judge's existing report now starts with club type, the regional dropdown or
free-text breed/speciality name, and ring number. No breed/speciality club dropdown
is offered to judges. The regional directory uses the 24 clubs on SKK's official
directory as checked on 26 October 2026. Proper club names retain their official
Swedish names; new field labels, controls and messages are English.
Source: https://www.skk.se/skk-funktionar/styrelse/vara-klubbar/lans--och-lokala-kennelklubbar/

## Activate on the existing backend

1. Apply `schema.sql` as before and apply `organiser-schema.sql` to the SAME
   `bsi-reports` D1 database before deploying the updated Worker. Both scripts are
   additive and idempotent; existing reports, assessments, email jobs and logs
   are retained. Deploy with the usual `pnpm build` and `wrangler deploy`.
2. Extend the existing Cloudflare Access application to cover `/organiser*` and
   `/api/organiser/*` as well as the SKK administration paths. Use the same
   configured audience and team domain. Keep `/reports`, `/receipts/*`, and
   `/public/shows` outside the Access login gate so the judge form can submit
   and select shows. `/public/shows` exposes only show ID/name/date/country for
   a specified regional club and date; never judges, allocations or status.
3. SKK managers use their existing private MANAGER_EMAILS configuration. Existing
   analysts can view all clubs' status but cannot import, grant access or correct
   associations. In the organiser page, managers grant individual regional-club
   permissions: Viewer (status only) or Editor (status, shows, imports).
4. The identity always comes from a verified Access JWT. Every request reloads
   active club memberships from D1. Changing a URL or request club ID cannot
   widen scope; revocation applies on the next request. A regional user cannot
   use SKK report/statistics/recipient APIs. No individual club login is created
   for breed/speciality clubs in this version.
5. Create a show using its organising club, name, date and country. Import its
   reviewed allocations before judges submit. Matching is case/whitespace
   tolerant; numeric ring padding is ignored. When the report date and regional
   club are selected, the connected judge form offers registered shows and
   fills the exact show name/country. Manual names still work and use the same
   stable club + normalised show/date/country identity.
6. Keep the existing site in test mode until the previously required accounts,
   sender domain, privacy/retention policy and live delivery tests are ready.
   This module needs no additional external service beyond the existing backend
   and Access configuration. User accounts and club grants must be authorised
   by SKK before live access is enabled.

## Import rules

- UTF-8 CSV (comma, semicolon or tab) and `.xlsx` are supported. Download both
  templates from the dashboard. Older `.xls` files need conversion to `.xlsx`.
- Columns `Ring`, `Judge`, `Breed` are required. Common English headings and the
  Swedish source headings Ringnummer, Domare and Ras are recognised. One breed
  per row; several rows may share a ring. Several worksheets can be selected.
- Breed names are mapped against the existing BSI list and a small explicit
  alias map. An unrecognised name requires the organiser to choose a listed
  breed or explicitly confirm **Not BSI-listed**. It is never silently excluded.
- A file is limited to 2 MB, 2,000 data rows and 100 columns. XML expansion is
  bounded; custom XML entities/DTDs and formula cells are rejected. Use plain
  cell values and a simple allocation worksheet, not a formatted show catalogue.
- Re-import replaces the active allocation for ONE selected show. Each import
  records a new revision and retains the old rows and audit trail. The submitted
  revision must still be current; a concurrent or stale import is rejected
  without partially replacing rows. Existing reports are never deleted.

## Status and matching

One requirement = active show + ring + judge + listed BSI breed. Matching uses
existing submission links and their creation timestamp. Assessments, free-text
comments, recipient addresses and receipt secrets are never returned to clubs.

- GREEN: a required allocation has at least one matching BSI report.
- RED: a required allocation has no matching report.
- GREY: the breed is not BSI-listed, so no BSI report is required.
- Completion = completed required allocations / required allocations. Duplicate
  submissions do not increase completion. Zero requirements means **Not defined**.
- A ring is complete only when every required breed/judge allocation is complete.
  Rings containing no listed breeds are grey. Unimported shows have undefined
  requirements, are explicitly identified, and are never labelled complete.
- Other/non-BSI reports remain centrally stored and appear as additional or
  unmatched status rows. They never fulfil an official BSI requirement even if
  their manually entered breed name resembles a listed breed.
- A judge/ring change can make an older submission unmatched. It is not silently
  transferred to another assignment. SKK managers can correct the effective
  association after review; the original report, statistics and saved/emailed PDF
  remain immutable. Corrections are audited.
- Live pages refresh every 20 seconds while visible, show the last successful
  refresh time, and flag errors without silently presenting old data as current.
  Display times use Europe/Stockholm; CSV/Excel exports use UTC timestamps.
- Show and judge search filters apply to the displayed completion denominator.

## SKK administration

The same organiser page shows the cross-club overview to SKK staff. Managers can
add/edit/revoke club access, correct club/show/ring/judge matching, and standardise
breed/speciality club names with aliases. Standardisation changes the canonical
club name used for future associations while retaining names in original reports.
An alias already assigned elsewhere cannot be silently taken over.

Existing historical submissions without an organiser link are listed to managers
(latest 200) for explicit association. Legacy records in the older `reports`
table still require the reviewed migration described in README.md; they are not
invented or relabelled automatically.

Status summaries export to CSV, XLSX and PDF, containing status metadata only.
The existing confidential report PDFs, email recipients and breed statistics
remain in their existing protected workflow.

Initial limits: 500 shows per status selection (choose narrower dates/club when
exceeded), 2,000 allocations per show/import, 50,000 allocation/status records per view,
and latest 200 unassociated historical
submissions. Very large installations need SQL aggregates/background status exports
before increasing those limits. Club-name merging and judge identity verification
are not automated; review ambiguity through SKK administration.

## Verification

`pnpm test` includes the previous regression suite plus organiser validation,
real SQLite integration, transactional rollback, per-club isolation, revocation,
CSV/XLSX parsing, unknown-breed review, multiple BSI breeds per ring, non-BSI
reports, revision conflicts, history preservation, status matching and corrections.
Tests use synthetic identities, signed test JWTs, real XLSX/PDF code and mocked
external services. They do not constitute a live SKK login or delivery test.
