# N4-N: candidate holdout V2 preparation (blocked draft)

2026-11-27. Offline tooling only. No production clustering, ArticleIndex, retrieval settings, API, or runtime changes. This is not a release or an independent review. Do not publish the maintainer manifest to reviewers.

## Scope and pinned inputs

The builder consumes four original Git blobs from `main`. It checks their byte-level Git blob SHA-1 before reading any dataset. A changed upstream fixture causes a hard failure; re-audit rather than relaxing the check.

| Input | Git blob SHA |
| --- | --- |
| `test/fixtures/news-quality-holdout-candidate.json` | `568b289ad198e7fa99503eac10bede855d824566` |
| `test/fixtures/news-event-real-corpus.json` | `dccb262113b8992b1de6b38744cf4b6384800bc3` |
| `test/fixtures/news-hybrid-search-queries.json` | `d96899ee4f8f31000228c8a2410089e9d2319b7d` |
| `scripts/performance/chinese-search-cases.ts` | `6bf8f2de0b4d5f92221fbc38721974fa55deb99b` |

The old fixtures remain unchanged. Quarantine four V1 reports and one query, supplement four new reports and twelve new queries. Keep the original `snapshotAt` as evaluation cutoff; the additions were published before that cutoff but inspected later. They are NOT claimed to have been captured in the original RSS snapshot. V1 capture metadata remains provenance only, not newly retained bytes. Supplements have provisional UTC+8 interpretation of publisher wall times; verify offsets before admission. Source IDs `tencent-cloud-developer` and `scnu-security` are offline dataset identifiers, not new production sources. They need integration validation. Preserve HN `submission` time, do not replace it with article publication time.

The exact inputs were read through GitHub and the transform's inventory and normalized-string checks were independently recalculated against them: 63 reports, 33 queries, 63 unique report URLs, 63 unique underlying article URLs, zero exact old report/query overlap, no invalid or after-cutoff timestamps. Daily zh/en 17/30; release 2/6; security 1/7. Query zh/mixed/latin 4/9/20. These are structural counts, not labels or scores. This separate calculation used string URL normalization; the local builder uses the WHATWG URL implementation and a copied, pinned normalization rule. The project's `safeNewsUrl` and `prepareReviewPacket` are still the authoritative guard.

## Run in repository root (Node 22)

```sh
node --test scripts/performance/holdout-v2.node-test.mjs
node scripts/performance/holdout-v2.mjs . /tmp/latestnews-holdout-v2-draft
```

The output directory must not exist. The builder emits only `news-quality-holdout-candidate-v2.json` (unreviewed draft) and `maintainer-manifest.json` (restricted data audit metadata). The manifest records the raw SHA-256 of the generated dataset, plan hash, input blob hashes, counts, quarantine decisions, inherited evidence, pending supplements and blockers. The dataset SHA-256 is not `packetDigest`. The builder is deterministic for fixed inputs and does not make network requests, run clustering/retrieval, or write review submissions.

## Admission sequence (manual gate)

1. Re-check article/seed discussion/item evidence and retain immutable evidence artifacts where permitted. Unknown access, time zone, original time and redirects must not be filled with guesses. The plan and manifest intentionally contain null capture hashes and final URLs for unknowns. Record real evidence, and independently check the full old/new underlying-event overlap and tuning exposure. Do not treat URL disjointness as event disjointness.
2. Expand remaining release/security Chinese coverage and diverse daily bilingual event candidates before freezing. Eight supplemental URLs are still queued. The proposed 100–120 reports / 40–50 queries is an engineering target, not a statistical guarantee. Candidate queries have no predeclared relevant sets or no-answer labels. Review variant intent dependence, date-only sources, and multi-event article handling. Suggested grouping guidance: identify primary news action or keep unknown; query relevance may concern secondary actions. Human reviewers must independently decide and document.
3. If all maintainer preconditions are satisfied, freeze a newly approved unlabeled dataset and run the original official CLI `prepare-holdout` on that file in a new directory. For example, only after approval:

   ```sh
   pnpm performance:quality-review prepare-holdout \
     /path/to/approved-unlabeled-dataset.json /tmp/latestnews-holdout-v2-packet
   ```

   Do not give reviewers this plan or manifest. The two authentic reviewers get the same packet and separate blank submissions. Follow [n4n-quality-review.md](n4n-quality-review.md). Scoring remains prohibited until real submissions meet the existing protocol. `automaticAdmission` is always false. Do not modify the production search strategy or enable hybrid retrieval.

## Validation and limitations

- Node v22.23.4 and pnpm 12.21.0: 16 standalone synthetic unit tests passed. Coverage includes deterministic transform, whitelist, duplicate report and article URLs, exact prior title/URL/query overlaps, ID collisions, time precision/cutoff, normalized queries, immutable input and explicit admission blockers. Synthetic tests do not create actual reviewer labels.
- Verified against a clean checkout of main at `ed3be3929eceae5a4d2956200aa07ff82fe65745`: frozen-lockfile offline dependency installation, pinned input verification and real builder CLI all succeeded. Candidate SHA-256: `f91e0f36afcd98ddd29d228c3179ba769e9913ab01016be582648ff748668bd8`. Counts match the inventory above.
- Official `prepare-holdout` succeeded in an isolated integration test (63 reports, 33 queries; packet digest `328333b3ca1acaa5aa6e0f6e58aad289b2906fa8067bf7c4fa00ed34814d00e2`). Both review submissions remained blank, with independence and no-prediction declarations false. The test packet is NOT admitted or distributed. Scoring was not run.
- 119 Vitest files / 664 tests passed, lint and Node/Web/Electron type checks passed. Only offline files are changed. The remaining evidence, semantic independence, coverage and human review requirements are still open.
