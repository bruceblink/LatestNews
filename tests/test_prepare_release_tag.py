"""离线测试手动发布标签的创建和复用边界。"""

import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch


spec = importlib.util.spec_from_file_location(
    "prepare_release_tag", Path(__file__).resolve().parents[1] / "scripts/prepare_release_tag.py"
)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class PrepareReleaseTagTests(unittest.TestCase):
    def setUp(self):
        self.commit = "a" * 40

    def test_reuses_matching_remote_tag(self):
        with patch.object(module, "current_commit", return_value=self.commit), \
             patch.object(module, "package_version", return_value="0.8.3"), \
             patch.object(module, "remote_commit", return_value=self.commit), \
             patch.object(module, "create_tag") as create:
            self.assertEqual(module.prepare("bruceblink/LatestNews", "v0.8.3"), (self.commit, False))
        create.assert_not_called()

    def test_creates_missing_tag_and_confirms_commit(self):
        with patch.object(module, "current_commit", return_value=self.commit), \
             patch.object(module, "package_version", return_value="0.8.3"), \
             patch.object(module, "remote_commit", side_effect=[None, self.commit]), \
             patch.object(module, "create_tag") as create:
            self.assertEqual(module.prepare("bruceblink/LatestNews", "v0.8.3"), (self.commit, True))
        create.assert_called_once_with("bruceblink/LatestNews", "v0.8.3", self.commit)

    def test_rejects_existing_tag_with_version_mismatch(self):
        with patch.object(module, "current_commit", return_value=self.commit), \
             patch.object(module, "package_version", return_value="0.8.2"), \
             patch.object(module, "remote_commit", return_value="b" * 40):
            with self.assertRaisesRegex(module.TagPreparationError, "version"):
                module.prepare("bruceblink/LatestNews", "v0.8.3")

    def test_rejects_version_mismatch(self):
        with patch.object(module, "current_commit", return_value=self.commit), \
             patch.object(module, "package_version", return_value="0.8.2"):
            with self.assertRaisesRegex(module.TagPreparationError, "version"):
                module.prepare("bruceblink/LatestNews", "v0.8.3")


if __name__ == "__main__":
    unittest.main()
