"""Fail-closed immutable Release guard. Run from a trusted workflow checkout."""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import subprocess
import tempfile
import zipfile


class ReleaseError(RuntimeError):
    pass


def require(condition, message):
    if not condition:
        raise ReleaseError(message)


def ordinary_env():
    env = os.environ.copy()
    env.pop('RELEASE_ADMIN_TOKEN', None)
    return env


def command(*args, env=None):
    return subprocess.check_output(args, text=True, env=ordinary_env() if env is None else env).strip()


def git(*args):
    return command('git', *args)


def sha256(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def remote_commit(tag):
    ref = f'refs/tags/{tag}'
    try:
        result = git('ls-remote', '--exit-code', 'origin', ref, ref + '^{}')
    except subprocess.CalledProcessError as exc:
        raise ReleaseError(f'Cannot verify existing remote tag {tag}; do not create or move it in CI. '
                           'A deleted immutable release tag cannot be reused.') from exc
    refs = {}
    for line in result.splitlines():
        sha, name = line.split('\t')
        require(name in (ref, ref + '^{}') and name not in refs and re.fullmatch(r'[0-9a-f]{40}', sha),
                'Unexpected remote tag response')
        refs[name] = sha
    require(ref in refs, f'Remote tag {tag} does not exist')
    return refs.get(ref + '^{}', refs[ref])


def validate_tag(tag):
    require(re.fullmatch(r'v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?', tag),
            'Release tag must be a version such as v1.2.3 or v1.2.3-rc.1')


def expected_artifacts(tag):
    return {
        'desktop-windows-x64', 'desktop-windows-arm64', 'desktop-macos-arm64',
        'desktop-linux-x64', 'desktop-linux-arm64', f'web-{tag}'
    }


REQUIRED_JOBS = {'Verify release source', 'Build Web deployment package', 'Build Windows x64',
                 'Build Windows ARM64', 'Build macOS Apple Silicon', 'Build Linux x64', 'Build Linux ARM64'}
DOCKER_JOB = 'Publish multi-architecture Docker image'


class GitHub:
    def __init__(self, repo):
        self.repo = repo
        self.root = f'repos/{repo}'

    def api(self, endpoint, *args, admin=False, pages=False):
        env = os.environ.copy()
        if admin:
            # Never use an administration token for Release mutations.
            env['GH_TOKEN'] = env.get('RELEASE_ADMIN_TOKEN') or env.get('GH_TOKEN', '')
        else:
            env.pop('RELEASE_ADMIN_TOKEN', None)
        try:
            raw = command('gh', 'api', *(['--paginate', '--slurp'] if pages else []),
                          f'{self.root}/{endpoint}', *args, env=env)
        except subprocess.CalledProcessError as exc:
            if admin:
                raise ReleaseError('Cannot read immutable-releases setting; configure a repository-scoped '
                                   'RELEASE_ADMIN_TOKEN with Administration: read.') from exc
            raise
        return json.loads(raw)

    def list(self, endpoint, key=None):
        pages = self.api(endpoint, pages=True)
        return [item for page in pages for item in (page[key] if key else page)]

    def immutable(self):
        require(self.api('immutable-releases', admin=True).get('enabled') is True,
                'Repository immutable releases must be enabled')

    def release(self, tag):
        matches = [r for r in self.list('releases?per_page=100') if r['tag_name'] == tag]
        require(len(matches) <= 1, f'Ambiguous releases for {tag}; manual review required')
        return matches[0] if matches else None

    def assets(self, release_id):
        return self.list(f'releases/{release_id}/assets?per_page=100')

    def download(self, artifact_id, archive):
        require(isinstance(artifact_id, int) and artifact_id > 0, 'Invalid artifact ID')
        # Stream the original ZIP, not a text-decoded or recompressed copy.
        with archive.open('wb') as stream:
            subprocess.run(['gh', 'api', '--method', 'GET',
                            f'{self.root}/actions/artifacts/{artifact_id}/zip'],
                           stdout=stream, env=ordinary_env(), check=True)

    def create(self, tag, notes):
        args = ['gh', 'release', 'create', tag, '--repo', self.repo, '--verify-tag', '--draft',
                '--title', tag, '--notes-file', str(notes)]
        if '-' in tag:
            args += ['--prerelease']
        command(*args)

    def upload(self, tag, path):
        # Never use --clobber. A name collision fails rather than deleting an asset.
        command('gh', 'release', 'upload', tag, str(path), '--repo', self.repo)

    def publish(self, release_id, prerelease):
        return self.api(f'releases/{release_id}', '--method', 'PATCH', '-F', 'draft=false',
                        '-f', 'make_latest=false' if prerelease else 'make_latest=legacy')


def marker(commit, run_id):
    return f'<!-- latestnews-release-commit: {commit} -->\n<!-- latestnews-source-run: {run_id} -->'


def check_draft(release, commit, run_id):
    if release is None:
        return
    require(release.get('draft') is True and release.get('immutable') is False,
            'Release is already published or immutable; refusing all changes')
    require(marker(commit, run_id) in (release.get('body') or ''),
            'Existing draft is missing the matching source commit/run marker; manual review required')


def verify_recovery(api, tag, commit, run_id):
    require(re.fullmatch(r'[1-9]\d*', run_id), 'Invalid artifact_run_id')
    run = api.api(f'actions/runs/{run_id}')
    require(run.get('status') == 'completed' and run.get('run_attempt') == 1,
            'Source run must be completed with one attempt; mixed-attempt artifacts require manual review')
    same_tag_run = run.get('head_sha') == commit and run.get('head_branch') == tag and run.get('event') == 'push'
    manual_dispatch_run = run.get('event') == 'workflow_dispatch' and run.get('head_branch') in ('main', 'master')
    require((same_tag_run or manual_dispatch_run) and
            run.get('path') == '.github/workflows/release.yml' and
            run.get('repository', {}).get('full_name', '').lower() == api.repo.lower() and
            run.get('head_repository', {}).get('full_name', '').lower() == api.repo.lower(),
            'Source run must originate from the matching release tag or trusted manual dispatch, repository and workflow')
    jobs = api.list(f'actions/runs/{run_id}/jobs?per_page=100', 'jobs')
    for name in REQUIRED_JOBS:
        found = [j for j in jobs if j['name'] == name]
        require(len(found) == 1 and found[0]['status'] == 'completed' and found[0]['conclusion'] == 'success',
                f'Required source job has not succeeded: {name}')
    artifacts = api.list(f'actions/runs/{run_id}/artifacts?per_page=100', 'artifacts')
    names = [a['name'] for a in artifacts]
    require(set(names) == expected_artifacts(tag) and len(names) == len(set(names)),
            'Missing, extra or duplicate source artifacts')
    for a in artifacts:
        require(a.get('expired') is False and a.get('size_in_bytes', 0) > 0 and
                re.fullmatch(r'sha256:[0-9a-f]{64}', a.get('digest') or '') and
                a.get('workflow_run', {}).get('head_sha') == commit and
                str(a.get('workflow_run', {}).get('id')) == run_id,
                f'Expired, incomplete or unrelated source artifact: {a["name"]}')
    docker = [j.get('conclusion') for j in jobs if j['name'] == DOCKER_JOB]
    return ('success' if docker == ['success'] else 'not-verified'), artifacts


def extract_verified_archive(archive, destination, digest):
    require('sha256:' + sha256(archive) == digest, f'Source artifact ZIP digest mismatch: {archive.name}')
    destination.mkdir(parents=True, exist_ok=False)
    with zipfile.ZipFile(archive) as zipped:
        seen = set()
        for info in zipped.infolist():
            path = PurePosixPath(info.filename)
            file_type = stat.S_IFMT(info.external_attr >> 16)
            require(bool(path.parts) and not path.is_absolute() and '..' not in path.parts and
                    '\\' not in info.filename and ':' not in info.filename and path not in seen and
                    file_type in (0, stat.S_IFREG, stat.S_IFDIR),
                    f'Unsafe or duplicate artifact ZIP entry: {info.filename}')
            seen.add(path)
        zipped.extractall(destination)


def recover(api, tag, commit, run_id, desktop_root, web_root):
    validate_tag(tag)
    require(remote_commit(tag) == commit and git('rev-parse', 'HEAD') == commit,
            'Remote tag or source commit changed before recovery')
    # Re-read metadata after the preflight. Download by immutable artifact ID,
    # verify the ZIP bytes against the GitHub-provided SHA-256, then extract.
    _, artifacts = verify_recovery(api, tag, commit, run_id)
    with tempfile.TemporaryDirectory() as directory:
        for artifact in artifacts:
            name = artifact['name']
            archive = Path(directory) / (name + '.zip')
            api.download(artifact['id'], archive)
            destination = web_root if name == f'web-{tag}' else desktop_root / name
            extract_verified_archive(archive, destination, artifact['digest'])
            archive.unlink()
            print(f'Verified and extracted source artifact {name} ({artifact["id"]})')


def expected_files(tag):
    prefix = 'LatestNews-' + tag[1:] + '-'
    names = {'latest.yml', 'latest-mac.yml', 'latest-linux.yml', 'latest-linux-arm64.yml', 'SHA256SUMS.txt', prefix + 'Web.zip'}
    for arch in ('x64', 'arm64'):
        suffix = f'Windows-{arch}.exe'
        names.update((prefix + suffix, prefix + suffix + '.blockmap'))
    for suffix in ('macOS-arm64.zip', 'macOS-arm64.dmg'):
        names.update((prefix + suffix, prefix + suffix + '.blockmap'))
    names.update(prefix + suffix for suffix in ('Linux-x86_64.AppImage', 'Linux-arm64.AppImage', 'Linux-amd64.deb', 'Linux-arm64.deb'))
    return names


def local_assets(root, tag):
    paths = list(root.iterdir())
    require({p.name for p in paths} == expected_files(tag), 'Unexpected or missing release assets')
    require(all(p.is_file() and not p.is_symlink() and p.stat().st_size > 0 for p in paths),
            'Release assets must be nonempty regular files')
    digests = {p.name: ('sha256:' + sha256(p), p.stat().st_size) for p in paths}
    checksums = {}
    for line in (root / 'SHA256SUMS.txt').read_text().splitlines():
        match = re.fullmatch(r'([0-9a-f]{64})  (.+)', line)
        require(match is not None, 'Invalid SHA256SUMS.txt line')
        checksum, name = match.groups()
        require(name not in checksums, 'Duplicate checksum entry')
        checksums[name] = 'sha256:' + checksum
    require(checksums == {n: d[0] for n, d in digests.items() if n != 'SHA256SUMS.txt'},
            'SHA256SUMS.txt does not match all release assets')
    return digests


def verify_assets(remote, local, complete=False):
    names = set()
    for asset in remote:
        name = asset['name']
        require(name in local and name not in names, f'Unexpected or duplicate remote asset: {name}')
        require(asset.get('state') == 'uploaded' and (asset.get('digest'), asset.get('size')) == local[name],
                f'Incomplete or mismatched remote asset: {name}; refusing overwrite')
        names.add(name)
    if complete:
        require(names == set(local), 'Remote release is missing required assets')
    return names


def preflight(api, tag, run_id, current_run, ref, workflow_sha):
    validate_tag(tag)
    commit = remote_commit(tag)
    require(git('rev-parse', f'refs/tags/{tag}^{{commit}}') == commit,
            'Local tag does not match remote tag')
    version = json.loads(git('show', f'{commit}:package.json'))['version']
    require(tag == 'v' + version, 'Tag and source package version differ')
    if not run_id:
        require(ref == f'refs/tags/{tag}' and git('rev-parse', f'{workflow_sha}^{{commit}}') == commit,
                'Normal release must run from the matching remote tag')
    source_run = run_id or current_run
    api.immutable()
    check_draft(api.release(tag), commit, source_run)
    docker = verify_recovery(api, tag, commit, run_id)[0] if run_id else 'success'
    return commit, docker


def finalize(api, tag, commit, run_id, root, notes):
    validate_tag(tag)
    require(remote_commit(tag) == commit and git('rev-parse', 'HEAD') == commit and
            git('rev-parse', f'refs/tags/{tag}^{{commit}}') == commit,
            'Remote tag or source commit changed')
    require(tag == 'v' + json.loads(Path('package.json').read_text())['version'], 'Source package version changed')
    local = local_assets(root, tag)
    api.immutable()
    release = api.release(tag)
    check_draft(release, commit, run_id)
    if release is None:
        # Write the provenance marker exactly once, even if a local test reruns.
        body = notes.read_text()
        if marker(commit, run_id) not in body:
            notes.write_text(body.rstrip() + '\n\n' + marker(commit, run_id) + '\n')
        api.create(tag, notes)
        release = api.release(tag)
        require(release is not None, 'Draft creation could not be confirmed')
        check_draft(release, commit, run_id)
    release_id = release['id']
    existing = verify_assets(api.assets(release_id), local)
    for name in sorted(set(local) - existing):
        current = api.release(tag)
        require(current is not None and current['id'] == release_id, 'Release identity changed during upload')
        check_draft(current, commit, run_id)
        api.upload(tag, root / name)
    current = api.release(tag)
    require(current is not None and current['id'] == release_id, 'Release identity changed before publication')
    check_draft(current, commit, run_id)
    verify_assets(api.assets(release_id), local, complete=True)
    require(remote_commit(tag) == commit, 'Remote tag changed before publication')
    api.immutable()
    published = api.publish(release_id, '-' in tag)
    require(published.get('id') == release_id and published.get('tag_name') == tag and
            published.get('draft') is False and published.get('immutable') is True,
            'Publication response did not confirm immutable release; investigate, never retry blindly')
    require(remote_commit(tag) == commit, 'Published tag commit mismatch')
    verify_assets(api.assets(release_id), local, complete=True)
    print(f'Published immutable Release {tag} ({commit}), {len(local)} verified assets')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('phase', choices=['preflight', 'recover', 'finalize'])
    parser.add_argument('--assets', type=Path, default=Path('release-assets'))
    parser.add_argument('--desktop', type=Path, default=Path('desktop-inputs'))
    parser.add_argument('--notes', type=Path, default=Path('release-notes.md'))
    args = parser.parse_args()
    api = GitHub(os.environ['GITHUB_REPOSITORY'])
    tag = os.environ['RELEASE_TAG']
    source_run = os.environ.get('SOURCE_RUN_ID', '')
    current_run = os.environ['GITHUB_RUN_ID']
    if args.phase == 'preflight':
        # 手动触发时由 prepare-tag job 传入已确认的标签引用和提交。
        ref = os.environ.get('RELEASE_REF', os.environ['GITHUB_REF'])
        workflow_sha = os.environ.get('RELEASE_WORKFLOW_SHA', os.environ['GITHUB_SHA'])
        commit, docker = preflight(api, tag, source_run, current_run, ref, workflow_sha)
        with open(os.environ['GITHUB_OUTPUT'], 'a') as out:
            out.write(f'commit={commit}\ndocker={docker}\n')
        print(f'Verified remote release tag {tag}: {commit}')
    elif args.phase == 'recover':
        recover(api, tag, os.environ['RELEASE_COMMIT'], source_run, args.desktop, args.assets)
    else:
        finalize(api, tag, os.environ['RELEASE_COMMIT'], source_run or current_run, args.assets, args.notes)


if __name__ == '__main__':
    try:
        main()
    except (ReleaseError, subprocess.CalledProcessError) as exc:
        raise SystemExit(str(exc)) from exc
