"""Offline follow-up verification; does not contact any news site."""
import copy
import importlib.util
import json
import subprocess
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
spec = importlib.util.spec_from_file_location("holdout_followup", HERE / "holdout-evidence-followup.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class FollowupTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.work = tempfile.TemporaryDirectory(prefix="holdout-followup-test-")
        cls.addClassCleanup(cls.work.cleanup)
        cls.frozen = Path(cls.work.name) / "frozen"
        subprocess.run(["node", str(HERE / "holdout-admission.mjs"), "freeze", str(ROOT), str(cls.frozen)],
                       check=True, capture_output=True)
        cls.dataset, cls.prior = module.load_inputs(cls.frozen / "candidate.json", cls.frozen / "current-evidence.json")
        cls.document = json.loads((ROOT / "test/fixtures/news-quality-holdout-v2-evidence-followup.json").read_bytes())

    def test_plan_retries_only_failed_original_roles_and_twenty_alternates(self):
        jobs = module.plan(self.dataset, self.prior)
        self.assertEqual(len(jobs), 46)
        self.assertEqual(len(set(jobs)), 46)
        self.assertEqual(sum(role == "hn-firebase" for _, role, _ in jobs), 20)
        captured = {(r["reportId"], r["role"]) for r in self.prior["rows"] if r["state"] == "captured"}
        self.assertTrue(all((rid, role) not in captured for rid, role, _ in jobs))

    def test_actual_fixture_recovers_25_positions_without_granting_admission(self):
        prior = copy.deepcopy(self.prior)
        result = module.verify(self.dataset, self.prior, self.document)
        self.assertEqual(result["status"], "blocked-draft")
        self.assertIs(result["automaticAdmission"], False)
        self.assertEqual(result["recoveredOriginalPositions"], 25)
        self.assertEqual(result["unresolvedOriginalPositions"], 1)
        self.assertEqual(result["alternateIdentity"], {"matched": 20})
        self.assertEqual(result["alternateOnlyMatchedHnItems"], 0)
        self.assertEqual(result["unresolved"][0]["reportId"], "candidate-060")
        self.assertEqual(result["unresolved"][0]["role"], "article")
        self.assertEqual(self.prior, prior)

    def test_wrong_original_pins_rejected(self):
        changed = Path(self.work.name) / "changed.json"
        changed.write_bytes((self.frozen / "candidate.json").read_bytes() + b" ")
        with self.assertRaisesRegex(ValueError, "differs"):
            module.load_inputs(changed, self.frozen / "current-evidence.json")

    def test_duplicate_missing_and_changed_observations_rejected(self):
        for action in ("duplicate", "missing", "url"):
            with self.subTest(action=action):
                d = copy.deepcopy(self.document)
                if action == "duplicate":
                    d["rows"].append(d["rows"][0])
                elif action == "missing":
                    d["rows"].pop()
                else:
                    d["rows"][0]["requestUrl"] = "https://example.org/"
                with self.assertRaises(ValueError):
                    module.verify(self.dataset, self.prior, d)

    def test_bad_chronology_and_fingerprint_rejected(self):
        for field, value in (("capturedAt", "2020-01-01T00:00:00Z"), ("responseSha256", "invalid")):
            with self.subTest(field=field):
                d = copy.deepcopy(self.document)
                row = next(r for r in d["rows"] if r["state"] == "captured")
                row[field] = value
                with self.assertRaises(ValueError):
                    module.verify(self.dataset, self.prior, d)

    def test_alternate_does_not_substitute_for_original_hn_role(self):
        d = copy.deepcopy(self.document)
        row = next(r for r in d["rows"] if r["role"] == "hn-item")
        row.update(state="network-error", status=None, finalUrl=None, bytes=None,
                   responseSha256=None, contentType=None, observed=None, error="synthetic timeout")
        result = module.verify(self.dataset, self.prior, d)
        self.assertEqual(result["recoveredOriginalPositions"], 24)
        self.assertEqual(result["unresolvedOriginalPositions"], 2)
        self.assertEqual(result["alternateOnly"], [row["reportId"]])

    def test_alternate_mismatch_flagged_without_human_label(self):
        d = copy.deepcopy(self.document)
        row = next(r for r in d["rows"] if r["role"] == "hn-firebase")
        row["observed"]["api"]["dead"] = True
        result = module.verify(self.dataset, self.prior, d)
        self.assertEqual(result["alternateIdentity"], {"matched": 19, "mismatch": 1})
        self.assertEqual(result["identityRisks"][0]["reportId"], row["reportId"])
        self.assertIs(result["automaticAdmission"], False)

    def test_firebase_parser_retains_only_scalar_identity_fields(self):
        raw = {"id": 42, "type": "story", "title": "Example", "url": "https://example.org/",
               "time": 1704067200, "dead": False, "deleted": False, "kids": [1, 2], "by": "not retained"}
        observed = module.capture_module.observed_metadata(json.dumps(raw).encode(), "application/json", "hn-firebase")
        self.assertEqual(set(observed["api"]), {"id", "type", "title", "url", "time", "dead", "deleted"})


if __name__ == "__main__":
    unittest.main()
