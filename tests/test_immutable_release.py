"""Offline regression tests: real local Git refs, simulated GitHub API, no network."""
import io
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
import zipfile
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('immutable_release', Path(__file__).resolve().parents[1] / 'scripts/immutable_release.py')
r = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)
TAG = 'v0.8.1'
RUN = '45212759432'


class FakeGitHub:
    repo = 'bruceblink/LatestNews'

    def __init__(self, commit):
        self.commit = commit
        self.draft = None
        self.remote_assets = []
        self.calls = []
        self.enabled = True
        self.docker = 'cancelled'
        self.bad_job = None
        self.artifact_error = None
        self.wrong_source = False
        self.published_immutable = True
        self.attempt = 1
        self.archives = {}

    def immutable(self):
        self.calls.append('settings')
        r.require(self.enabled, 'Immutable releases disabled')

    def release(self, tag):
        return self.draft

    def create(self, tag, notes):
        self.calls.append('create')
        self.draft = {'id': 10, 'tag_name': tag, 'draft': True, 'immutable': False, 'body': notes.read_text()}

    def assets(self, release_id):
        assert release_id == 10
        return list(self.remote_assets)

    def upload(self, tag, path):
        self.calls.append(('upload', path.name))
        self.remote_assets.append({'name': path.name, 'digest': 'sha256:' + r.sha256(path), 'size': path.stat().st_size, 'state': 'uploaded'})

    def publish(self, release_id, prerelease):
        self.calls.append('publish')
        self.draft.update(draft=False, immutable=self.published_immutable)
        return dict(self.draft)

    def api(self, endpoint, **kwargs):
        assert endpoint == f'actions/runs/{RUN}'
        return {'status': 'completed', 'run_attempt': self.attempt, 'head_sha': '0' * 40 if self.wrong_source else self.commit,
                'head_branch': TAG, 'path': '.github/workflows/release.yml', 'event': 'push',
                'repository': {'full_name': self.repo}, 'head_repository': {'full_name': self.repo}}

    def list(self, endpoint, key):
        if key == 'jobs':
            return [{'name': n, 'status': 'completed', 'conclusion': 'failure' if self.bad_job == n else 'success'}
                    for n in r.REQUIRED_JOBS] + [{'name': r.DOCKER_JOB, 'conclusion': self.docker}]
        artifacts = []
        for index, name in enumerate(sorted(r.expected_artifacts(TAG)), start=1):
            import hashlib
            buffer = io.BytesIO()
            with zipfile.ZipFile(buffer, 'w') as zipped:
                zipped.writestr('fixture.txt', name)
            data = buffer.getvalue()
            self.archives[index] = data
            artifacts.append({'id': index, 'name': name, 'expired': False, 'size_in_bytes': len(data),
                              'digest': 'sha256:' + hashlib.sha256(data).hexdigest(),
                              'workflow_run': {'head_sha': self.commit, 'id': int(RUN)}})
        if self.artifact_error == 'expired':
            artifacts[0]['expired'] = True
        if self.artifact_error == 'missing':
            artifacts.pop()
        if self.artifact_error == 'wrong-run':
            artifacts[0]['workflow_run']['id'] = 1
        return artifacts

    def download(self, artifact_id, archive):
        archive.write_bytes(self.archives[artifact_id])


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.original = Path.cwd()
        self.addCleanup(os.chdir, self.original)
        base = Path(self.tmp.name)
        # Only local repositories are used. No remote network or credentials.
        subprocess.run(['git', 'init', '-q', '--bare', str(base / 'remote.git')], check=True)
        self.work = base / 'work'
        self.work.mkdir()
        os.chdir(self.work)
        self.git('init', '-q')
        self.git('config', 'user.name', 'bruceblink')
        self.git('config', 'user.email', 'likanug.g@gmail.com')
        self.git('remote', 'add', 'origin', str(base / 'remote.git'))
        Path('package.json').write_text(json.dumps({'version': TAG[1:]}))
        self.git('add', 'package.json')
        self.git('commit', '-qm', 'source fixture')
        self.commit = self.git('rev-parse', 'HEAD')
        self.api = FakeGitHub(self.commit)
        self.assets = Path('release-assets')
        self.assets.mkdir()
        self.notes = Path('release-notes.md')
        self.notes.write_text('Test release\n')
        for name in r.expected_files(TAG) - {'SHA256SUMS.txt'}:
            (self.assets / name).write_bytes(name.encode())
        self.manifest()

    def git(self, *args):
        return subprocess.check_output(['git', *args], text=True, stderr=subprocess.PIPE).strip()

    def tag(self, annotated=False):
        self.git('tag', *(['-a', '-m', 'test'] if annotated else []), TAG)
        self.git('push', '-q', 'origin', f'refs/tags/{TAG}')

    def manifest(self):
        (self.assets / 'SHA256SUMS.txt').write_text(''.join(f'{r.sha256(p)}  {p.name}\n' for p in sorted(self.assets.iterdir()) if p.name != 'SHA256SUMS.txt'))

    def preflight(self, recovery=True, ref='refs/heads/main'):
        return r.preflight(self.api, TAG, RUN if recovery else '', RUN, ref, self.commit)

    def finalize(self):
        return r.finalize(self.api, TAG, self.commit, RUN, self.assets, self.notes)

    def draft(self):
        self.notes.write_text(r.marker(self.commit, RUN))
        self.api.create(TAG, self.notes)
        self.api.calls.clear()

    def assert_no_writes(self):
        self.assertFalse(any(c == 'create' or c == 'publish' or isinstance(c, tuple) for c in self.api.calls))

    def test_local_only_tag_is_rejected_before_api(self):
        self.git('tag', TAG)
        with self.assertRaisesRegex(r.ReleaseError, 'existing remote tag'):
            self.preflight()
        self.assertEqual(self.api.calls, [])

    def test_lightweight_tag(self):
        self.tag()
        self.assertEqual(self.preflight(), (self.commit, 'not-verified'))

    def test_annotated_tag_is_peeled(self):
        self.tag(annotated=True)
        self.assertEqual(self.preflight()[0], self.commit)

    def test_normal_dispatch_requires_matching_tag_ref(self):
        self.tag()
        with self.assertRaisesRegex(r.ReleaseError, 'matching remote tag'):
            self.preflight(recovery=False)
        self.assertEqual(self.preflight(recovery=False, ref=f'refs/tags/{TAG}'), (self.commit, 'success'))

    def test_wrong_artifact_commit(self):
        self.tag()
        self.api.wrong_source = True
        with self.assertRaisesRegex(r.ReleaseError, 'Source run must originate'):
            self.preflight()
        self.assert_no_writes()

    def test_failed_required_build(self):
        self.tag()
        self.api.bad_job = 'Build Windows x64'
        with self.assertRaisesRegex(r.ReleaseError, 'Required source job'):
            self.preflight()
        self.assert_no_writes()

    def test_expired_missing_and_unrelated_artifact(self):
        self.tag()
        for error in ('expired', 'missing', 'wrong-run'):
            with self.subTest(error=error):
                self.api.artifact_error = error
                with self.assertRaises(r.ReleaseError):
                    self.preflight()
        self.assert_no_writes()

    def test_recovery_downloads_exact_seven_archives_and_verifies_bytes(self):
        self.tag()
        r.recover(self.api, TAG, self.commit, RUN, Path('recovered-desktop'), Path('recovered-web'))
        self.assertEqual(len(list(Path('recovered-desktop').iterdir())), 6)
        self.assertEqual(Path('recovered-web/fixture.txt').read_text(), f'web-{TAG}')
        self.assert_no_writes()

    def test_recovery_zip_digest_mismatch_fails(self):
        self.tag()
        original = self.api.download
        def tamper(artifact_id, archive):
            original(artifact_id, archive)
            with archive.open('ab') as stream:
                stream.write(b'changed')
        self.api.download = tamper
        with self.assertRaisesRegex(r.ReleaseError, 'ZIP digest mismatch'):
            r.recover(self.api, TAG, self.commit, RUN, Path('recovered-desktop'), Path('recovered-web'))
        self.assert_no_writes()

    def test_zip_traversal_is_rejected(self):
        archive = Path('unsafe.zip')
        with zipfile.ZipFile(archive, 'w') as zipped:
            zipped.writestr('../escaped.txt', 'unexpected')
        with self.assertRaisesRegex(r.ReleaseError, 'Unsafe or duplicate'):
            r.extract_verified_archive(archive, Path('extracted'), 'sha256:' + r.sha256(archive))
        self.assertFalse(Path('escaped.txt').exists())

    def test_wrong_source_package_version(self):
        Path('package.json').write_text('{"version":"0.8.2"}')
        self.git('add', 'package.json')
        self.git('commit', '-qm', 'different package version')
        self.tag()
        with self.assertRaisesRegex(r.ReleaseError, 'source package version differ'):
            self.preflight()
        self.assert_no_writes()

    def test_mixed_attempts_fail_closed(self):
        self.tag()
        self.api.attempt = 2
        with self.assertRaisesRegex(r.ReleaseError, 'one attempt'):
            self.preflight()

    def test_immutable_setting_disabled(self):
        self.tag()
        self.api.enabled = False
        with self.assertRaisesRegex(r.ReleaseError, 'disabled'):
            self.preflight()
        self.assert_no_writes()

    def test_new_draft_uploads_all_22_then_publishes(self):
        self.tag()
        self.finalize()
        self.assertEqual(len(self.api.remote_assets), 22)
        self.assertTrue(self.api.draft['immutable'])
        self.assertEqual(self.api.calls[-1], 'publish')
        self.assertEqual(self.api.calls.count('create'), 1)

    def test_matching_partial_draft_is_resumed_without_overwrite(self):
        self.tag()
        self.draft()
        self.api.upload(TAG, self.assets / 'latest.yml')
        self.api.calls.clear()
        self.finalize()
        self.assertEqual(len(self.api.remote_assets), 22)
        self.assertNotIn(('upload', 'latest.yml'), self.api.calls)
        self.assertNotIn('create', self.api.calls)

    def test_published_release_is_never_mutated(self):
        self.tag()
        self.draft()
        self.api.draft.update(draft=False, immutable=True)
        with self.assertRaisesRegex(r.ReleaseError, 'already published'):
            self.finalize()
        self.assert_no_writes()

    def test_wrong_draft_marker(self):
        self.tag()
        self.draft()
        self.api.draft['body'] = 'Unknown provenance'
        with self.assertRaisesRegex(r.ReleaseError, 'matching source'):
            self.finalize()
        self.assert_no_writes()

    def test_conflicting_existing_asset_is_not_replaced(self):
        self.tag()
        self.draft()
        self.api.upload(TAG, self.assets / 'latest.yml')
        self.api.remote_assets[0]['digest'] = 'sha256:' + '0' * 64
        self.api.calls.clear()
        with self.assertRaisesRegex(r.ReleaseError, 'refusing overwrite'):
            self.finalize()
        self.assert_no_writes()

    def test_missing_remote_digest_fails_closed(self):
        self.tag()
        self.draft()
        self.api.upload(TAG, self.assets / 'latest.yml')
        self.api.remote_assets[0].pop('digest')
        self.api.calls.clear()
        with self.assertRaisesRegex(r.ReleaseError, 'refusing overwrite'):
            self.finalize()
        self.assert_no_writes()

    def test_corrupt_local_checksum(self):
        self.tag()
        (self.assets / 'latest.yml').write_text('modified after verification')
        with self.assertRaisesRegex(r.ReleaseError, 'SHA256SUMS.txt does not match'):
            self.finalize()
        self.assert_no_writes()

    def test_missing_local_asset(self):
        self.tag()
        (self.assets / 'latest.yml').unlink()
        with self.assertRaisesRegex(r.ReleaseError, 'missing release assets'):
            self.finalize()
        self.assert_no_writes()

    def test_missing_remote_asset_stops_publication(self):
        self.tag()
        original = self.api.upload
        def drop_one(tag, path):
            if path.name != 'latest.yml':
                original(tag, path)
        self.api.upload = drop_one
        with self.assertRaisesRegex(r.ReleaseError, 'missing required assets'):
            self.finalize()
        self.assertNotIn('publish', self.api.calls)

    def test_tag_change_during_upload_stops_publication(self):
        self.tag()
        with patch.object(r, 'remote_commit', side_effect=[self.commit, '0' * 40]):
            with self.assertRaisesRegex(r.ReleaseError, 'Remote tag changed before publication'):
                self.finalize()
        self.assertNotIn('publish', self.api.calls)

    def test_publication_must_confirm_immutable(self):
        self.tag()
        self.api.published_immutable = False
        with self.assertRaisesRegex(r.ReleaseError, 'did not confirm immutable'):
            self.finalize()
        self.assertEqual(self.api.calls.count('publish'), 1)

    def test_no_release_when_local_head_differs(self):
        self.tag()
        self.git('commit', '--allow-empty', '-qm', 'different source')
        with self.assertRaisesRegex(r.ReleaseError, 'source commit changed'):
            self.finalize()
        self.assert_no_writes()

    def test_ambiguous_drafts_rejected(self):
        api = r.GitHub(self.api.repo)
        with patch.object(api, 'list', return_value=[{'tag_name': TAG}, {'tag_name': TAG}]):
            with self.assertRaisesRegex(r.ReleaseError, 'Ambiguous releases'):
                api.release(TAG)

    def test_immutable_admin_token_not_used_for_mutations(self):
        api = r.GitHub(self.api.repo)
        with patch.dict(os.environ, {'GH_TOKEN': 'write-token', 'RELEASE_ADMIN_TOKEN': 'read-token'}), \
             patch.object(r, 'command', return_value='{"enabled":true}') as cmd:
            api.immutable()
            self.assertEqual(cmd.call_args.kwargs['env']['GH_TOKEN'], 'read-token')
            api.publish(10, False)
            self.assertEqual(cmd.call_args.kwargs['env']['GH_TOKEN'], 'write-token')
            self.assertNotIn('RELEASE_ADMIN_TOKEN', cmd.call_args.kwargs['env'])


if __name__ == '__main__':
    unittest.main()
