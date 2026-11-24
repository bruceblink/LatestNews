# Immutable Release and artifact recovery

## Prerequisites

- Enable repository immutable releases and retain existing tag protections.
- Configure `RELEASE_ADMIN_TOKEN` if the default workflow token cannot read
  the immutable-releases endpoint. Use a repository-scoped token with
  Administration: read, not Administration: write. The regular workflow
  `GITHUB_TOKEN` performs release operations; the admin-read token only reads
  the setting. Do not use the token to bypass rulesets.
- Use an existing remote release tag that resolves to the intended commit and
  matches the version in that commit's `package.json`. For normal manual runs,
  dispatch from the matching tag. Pushes and recovery runs for the same release
  version share one concurrency group.
- The expected installer/metadata contract is the 22 assets produced by the
  six Electron desktop targets and the Web package. Update the explicit
  contract and tests together if packaging changes.

## Recovery after a publication-only failure

Dispatch `.github/workflows/release.yml` from a trusted revision containing the
fixed workflow, supplying `release_tag` and `artifact_run_id`. The source run
must be a completed release workflow on the same tag and commit, in this
repository. Only single-attempt source runs are accepted automatically; the
source checks and all seven build groups must have succeeded. All seven
artifacts must still be available. ZIP archives are downloaded by exact artifact
ID and checked against GitHub's SHA-256 before extraction. Recovery does not
rebuild or publish a Docker image. The release notes record this limitation if
Docker was not successful in the source run.

The guard verifies the real remote tag, checks out its commit, and validates
all local release assets. Drafts must carry the matching source commit and run
ID marker. Identical uploaded assets are retained; differing, incomplete,
unknown or duplicate assets cause a hard failure. No automatic deletion or
replacement is permitted. The final publication rechecks the remote tag,
immutable setting and all remote asset digests, then publishes by release ID
and checks the result. If publication might have succeeded but confirmation
fails, inspect the release instead of retrying blindly.

## v0.8.1 incident (2026-11-24)

The old recovery run 45233674380 created only a local tag and failed while
publishing an uploaded draft. GitHub reported that the tag name was previously
used by an immutable release. The remote tag and release returned 404. GitHub
reserves deleted immutable-release tag names; do not attempt to recreate,
force-move or delete a tag, change protections, or republish the same version.

Source run 45212759432, commit
`6358e316f0db5a38677feac65a1186fe78771250`, has seven non-expired artifacts at
inspection time; the Docker job was cancelled. Preserve the original artifacts
and their metadata as historical build evidence before their expiration on
2026-12-07 UTC. They are NOT valid assets for a new version. A replacement
version such as v0.8.2 must have its version changed in source and build all
packages and updater metadata again. Do not rename v0.8.1 binaries or edit
only their manifests.

## Regression tests

Run locally (Python 3.12 and Git):

```sh
python3 -m unittest discover -s tests -p test_immutable_release.py -v
```

The tests use temporary local Git repositories and simulated GitHub operations;
no real GitHub release is created, changed or published. A real GitHub Actions
run on an approved new tag remains necessary for end-to-end acceptance.
