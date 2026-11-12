# LogEn private accounts

Project: butukbeoxxgyoaluctdi (LogEn, eu-west-1). Migrations 001_private_records.sql and 002_http_conflict_response.sql were applied through the Supabase migration tool on 2026-11-08. The confirmed owner account is provisioned; no credentials are stored in the repository.

The online build uses Supabase Auth email/password sign-in, user-owned workspace records, revision checks and private attachments. The browser uses only the public publishable key. Access tokens stay in memory, and reload requires sign-in. Caches and unsynced recovery copies are scoped to authenticated UUIDs.

Verification: record_isolation.sql passed against the project, using two synthetic authenticated roles and anonymous access inside a rolled-back transaction. It verifies owner reads, cross-user read/update/delete/forged-insert denial, private file policies and stale revision rejection. No synthetic users/data remain. Database ownership checks passed. The Auth advisor notes that provider-side leaked-password protection is disabled; no paid plan or billing settings were changed. Node adapter/coordinator tests cover refresh, delayed account changes, save conflicts, recovery retention and attachment serialization. tools/check_cloud.cjs verifies the confirmed account in Edge at phone, tablet and desktop widths.

Migration of legacy browser data is explicit and owner-only. The owner must save the full backup ZIP before confirming the upload. No other new user receives the shared legacy data. JSON workspace backups alone do not contain drawing files; preserve the complete ZIP and original source files.

Limitations: the offline edition remains device-only. Cloud accounts currently must be provisioned/confirmed through Supabase Auth; there is no public sign-up/admin screen. Configure the Supabase Auth site URL and allowed redirect URLs before enabling email recovery or invitations that return to the hosted app. Cloud attachment limits also depend on the project's provider/plan settings. Simultaneous edits are detected; automatic merging is not implemented. Shared-device caches are browser data, so use separate browser/OS profiles when local device access must also be private.

Build: python tools/build_offline.py followed by node tools/build_cloud.cjs. Only docs/index.html is the cloud edition. Never embed privileged keys or restore the offline verifier in that build.


## Large drawings and connection failures

Large drawing/layout snapshots are gzip-compressed into the existing private attachment bucket. The database stores a versioned snapshot reference once the encoded record exceeds 128 KiB. Previous inline records remain readable and are not migrated or replaced on read. Geometry traversal no longer creates a promise for every coordinate; actual file transfers are serialized. Revision conflicts continue to protect previous records.

Ordinary cloud requests have a 30-second deadline; attachment transfers allow 120 seconds. Network failures, server 5xx responses and timeouts are reported distinctly. Failed sign-in never unlocks cached account data, and workspace pending recovery copies are retained. This handling does not restore an unhealthy Supabase instance; inspect provider health/logs when auth endpoints return 522 or database saves time out.
