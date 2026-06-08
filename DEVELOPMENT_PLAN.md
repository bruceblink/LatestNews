# LatestNews Development Plan

## Audit Baseline

- Repository state: clean `main` branch before this plan was created.
- Validation baseline: `pnpm check` passes lint, typecheck, and the full Vitest suite.
- Production baseline: `pnpm build` succeeds and produces Nitro output under `dist/output`.
- Scope: this plan targets the current React/Vite/Nitro LatestNews application. The cross-system BFF architecture in `architecture.md` is treated as a separate future program, not as a blocker for completing this repository.

## Audit Findings

1. Sync authentication handling is too broad. `handleAuthError` treats ordinary API or network failures as authentication failures, which can log the user out for non-auth sync errors.
2. Metadata sync requests rely on cookies only even though other refresh flows already support `localStorage.access_token` as a Bearer token. Sync should keep cookie support while adding Bearer when available.
3. RSS parsing still contains explicit TypeScript suppression comments around dynamic feed fields. The parser should be typed at the XML boundary and covered with focused tests.
4. The Docker build stage installs dependencies without `--frozen-lockfile` and copies the full workspace twice, making container builds less reproducible and less cache-friendly.
5. The production build reports stale Browserslist data, adding avoidable maintenance noise to otherwise successful builds.

## Completion Plan

1. Harden sync authentication behavior. Done.
   - Classify only 401 and 403 as authentication failures.
   - Preserve normal sync error reporting for non-auth failures.
   - Add optional Bearer authorization headers when `access_token` exists.
   - Add unit tests for the auth-error classifier.

2. Type RSS parsing without suppression. Done.
   - Add a typed XML boundary around RSS/Atom parsing.
   - Remove `@ts-expect-error` and adjacent parser TODOs.
   - Export a pure parser function and test RSS plus Atom feed shapes.

3. Improve container build reproducibility. Done.
   - Use lockfile-based install in the Docker builder stage.
   - Copy dependency manifests before the full workspace to restore Docker layer caching.

4. Verify the completed plan. Done.
   - Run targeted tests for new logic.
   - Run `pnpm check`.
   - Run `pnpm build`.
   - Recheck git status and summarize remaining non-blocking warnings.

5. Refresh browser compatibility data. Done.
   - Update `caniuse-lite` lockfile entries.
   - Confirm the Browserslist stale-data warning is gone in production builds.

## Final Verification

- `pnpm check` passed after implementation.
- `pnpm build` passed after implementation.
- Remaining build warnings are non-blocking: several third-party favicon downloads timed out and existing/default icons were used.
