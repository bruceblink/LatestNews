#!/usr/bin/env python3
"""Generate a readable bilingual GitHub release body from git history."""

from __future__ import annotations

import argparse
import datetime as dt
import re
import subprocess
from collections import OrderedDict
from pathlib import Path
from typing import Iterable


COMMIT_RE = re.compile(
    r"^(?P<type>[A-Za-z][A-Za-z0-9_-]*)(?:\([^)]*\))?(?P<breaking>!)?:\s*(?P<subject>.+)$"
)
TAG_RE = re.compile(r"^[0-9A-Za-z][0-9A-Za-z._+-]*$")

CATEGORY_ORDER = (
    "feat",
    "fix",
    "security",
    "perf",
    "maintenance",
    "other",
)
CATEGORY_LABELS = {
    "feat": "🚀 新功能 / Features",
    "fix": "🐛 问题修复 / Bug Fixes",
    "security": "🔒 安全 / Security",
    "perf": "⚡ 性能优化 / Performance",
    "maintenance": "🧰 维护、文档与测试 / Maintenance, Docs & Tests",
    "other": "📝 其他变更 / Other Changes",
}
TYPE_TO_CATEGORY = {
    "feat": "feat",
    "feature": "feat",
    "fix": "fix",
    "bugfix": "fix",
    "security": "security",
    "sec": "security",
    "perf": "perf",
    "opt": "perf",
    "docs": "maintenance",
    "doc": "maintenance",
    "refactor": "maintenance",
    "test": "maintenance",
    "tests": "maintenance",
    "ci": "maintenance",
    "build": "maintenance",
    "chore": "maintenance",
    "style": "maintenance",
    "release": "maintenance",
    "revert": "maintenance",
}


def git(*args: str) -> str:
    """Run a git command and return UTF-8 output for the checked-out release tag."""
    result = subprocess.run(
        ["git", *args],
        check=True,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    return result.stdout


def github_repository(explicit: str | None) -> str:
    """Normalize the origin remote into an HTTPS GitHub repository URL."""
    try:
        remote = explicit or git("config", "--get", "remote.origin.url").strip()
    except subprocess.CalledProcessError:
        return ""
    if remote.startswith("git@github.com:"):
        remote = "https://github.com/" + remote.removeprefix("git@github.com:")
    elif remote.startswith("ssh://git@github.com/"):
        remote = "https://github.com/" + remote.removeprefix("ssh://git@github.com/")
    remote = remote.removesuffix(".git").rstrip("/")
    return remote if "github.com/" in remote else ""


def previous_tag(tag: str) -> str | None:
    """Find the newest version tag before the current tag on its reachable history."""
    tags = git(
        "tag",
        "--merged",
        tag,
        "--list",
        "*",
        "--sort=-version:refname",
    ).splitlines()
    candidates = [candidate.strip() for candidate in tags if candidate.strip() != tag]
    if tag.startswith("v"):
        candidates = [candidate for candidate in candidates if candidate.startswith("v")]
    elif tag[0].isdigit():
        candidates = [candidate for candidate in candidates if candidate[0].isdigit()]
    return next((candidate for candidate in candidates if TAG_RE.fullmatch(candidate)), None)


def release_date(tag: str) -> str:
    """Use the tagged commit date so rerunning a release stays deterministic."""
    return git("show", "-s", "--format=%cs", tag).strip() or dt.date.today().isoformat()


def classify(commit_type: str) -> str:
    """Map a conventional commit type into the small set shown in release notes."""
    return TYPE_TO_CATEGORY.get(commit_type.lower(), "other")


def commits_between(tag: str, base: str | None) -> Iterable[tuple[str, str, str]]:
    """Return non-merge commits as (sha, category, subject), newest first."""
    revision = f"{base}..{tag}" if base else tag
    output = git("log", revision, "--no-merges", "--format=%H%x09%s")
    for line in output.splitlines():
        sha, _, subject = line.partition("\t")
        if not sha or not subject:
            continue
        match = COMMIT_RE.match(subject.strip())
        if match:
            commit_type = match.group("type")
            subject = match.group("subject").strip()
        else:
            commit_type = "other"
            subject = subject.strip()
        yield sha, classify(commit_type), subject


def commit_link(repository: str, sha: str, subject: str) -> str:
    """Link a change to its source commit while keeping the release body compact."""
    if repository:
        return f"[{subject}]({repository}/commit/{sha})"
    return subject


def render(
    tag: str,
    base: str | None,
    repository: str,
    release_date: str,
) -> str:
    """Build the stable release layout shared by every maintained repository."""
    grouped: OrderedDict[str, list[tuple[str, str]]] = OrderedDict(
        (category, []) for category in CATEGORY_ORDER
    )
    for sha, category, subject in commits_between(tag, base):
        grouped[category].append((sha, subject))

    if not any(grouped.values()):
        grouped["maintenance"].append(("", "No user-visible changes."))

    version = tag.removeprefix("v")
    lines = [f"## [{version}] - {release_date}", ""]
    for category in CATEGORY_ORDER:
        changes = grouped[category]
        if not changes:
            continue
        lines.extend([f"### {CATEGORY_LABELS[category]}", ""])
        for sha, subject in changes:
            lines.append(f"- {commit_link(repository, sha, subject)}")
        lines.append("")

    if base and repository:
        lines.extend(
            [
                "---",
                "",
                f"**Full Changelog:** [{base}...{tag}]"
                f"({repository}/compare/{base}...{tag})",
                "",
            ]
        )
    elif repository:
        lines.extend(
            [
                "---",
                "",
                f"**Release commit:** [{tag}]({repository}/releases/tag/{tag})",
                "",
            ]
        )
    return "\n".join(lines)


def main() -> None:
    """Parse release inputs, generate the body, and write it as UTF-8 Markdown."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tag", required=True)
    parser.add_argument("--previous-tag")
    parser.add_argument("--repository")
    parser.add_argument("--date")
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    if not TAG_RE.fullmatch(args.tag):
        raise SystemExit(f"tag must be a non-empty release tag: {args.tag}")

    base = args.previous_tag or previous_tag(args.tag)
    body = render(
        args.tag,
        base,
        github_repository(args.repository),
        args.date or release_date(args.tag),
    )
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(body, encoding="utf-8")
    print(f"release notes written: {output}")


if __name__ == "__main__":
    main()
