"""Offline parser and request-boundary regression tests; no network calls."""
import importlib.util
import json
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location("holdout_evidence_capture", Path(__file__).with_name("holdout-evidence-capture.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class CaptureTest(unittest.TestCase):
    def test_document_title_does_not_join_svg_title(self):
        raw = b"<html><head><title>News &amp; title</title></head><body><svg><title>Navigation</title></svg></body></html>"
        m = module.observed_metadata(raw, "text/html", "article")
        self.assertEqual(m["title"], "News & title")

    def test_head_publish_metadata_excludes_body_meta(self):
        raw = b'<html><head><meta property="article:published_time" content="2026-01-01T00:00:00Z"></head><body><meta property="article:published_time" content="2020-01-01T00:00:00Z"></body></html>'
        m = module.observed_metadata(raw, "text/html", "article")
        self.assertEqual(m["publishedMetadata"], [{"field": "article:published_time", "value": "2026-01-01T00:00:00Z"}])

    def test_wall_time_is_retained_without_inventing_timezone(self):
        raw = "<html><head><title>标题</title></head><body>发表于 2024年11月18日 11时35分</body></html>".encode()
        m = module.observed_metadata(raw, "text/html", "article")
        self.assertEqual(m["solidotWallTime"], "2024-11-18 11:35")

    def test_plain_text_is_not_assigned_a_title(self):
        m = module.observed_metadata(b"Plain-text release notice", "text/plain", "article")
        self.assertEqual(m, {"title": None, "publishedMetadata": [], "solidotWallTime": None})

    def test_hn_api_retains_identity_only(self):
        j = {"id": 42, "type": "story", "title": "Test", "url": "https://example.org/a", "created_at": "2024-01-01T00:00:00Z", "children": [{"text": "not retained"}], "author": "not retained"}
        m = module.observed_metadata(json.dumps(j).encode(), "application/json", "hn-item")
        self.assertEqual(set(m["api"]), {"id", "type", "title", "url", "created_at"})

    def test_request_and_redirect_scope(self):
        hosts = {"example.org"}
        self.assertEqual(module.checked_url("https://example.org/a", hosts), "https://example.org/a")
        for url in ("http://example.org/a", "https://other.org/a", "https://user@example.org/a", "https://example.org:8443/a"):
            with self.subTest(url=url), self.assertRaises(ValueError):
                module.checked_url(url, hosts)

    def test_role_selection_does_not_replay_mutable_rss(self):
        d = {"reports": [
            {"id": "r1", "source": "rss", "timeKind": "published", "articleUrl": "https://example.org/a", "url": "https://example.org/a", "evidenceUrl": "https://example.org/rss"},
            {"id": "r2", "source": "hackernews", "timeKind": "submission", "articleUrl": "https://example.org/b", "url": "https://news.ycombinator.com/item?id=1", "evidenceUrl": "https://hn.algolia.com/api/v1/items/1"},
            {"id": "r3", "source": "github-release", "timeKind": "published", "articleUrl": "https://github.com/example/project/releases/tag/v1", "url": "https://github.com/example/project/releases/tag/v1", "evidenceUrl": "https://api.github.com/repos/example/project/releases/tags/v1"},
        ]}
        jobs = module.jobs_for(d)
        self.assertEqual(len(jobs), 6)
        self.assertNotIn(("r1", "article", "https://example.org/rss"), jobs)
        self.assertIn(("r2", "hn-item", d["reports"][1]["evidenceUrl"]), jobs)
        self.assertIn(("r3", "release-api", d["reports"][2]["evidenceUrl"]), jobs)


if __name__ == "__main__":
    unittest.main()
