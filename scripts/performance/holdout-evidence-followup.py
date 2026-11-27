#!/usr/bin/env python3
"""Targeted current evidence follow-up. The original freeze is never rewritten."""
import concurrent.futures
import datetime
import hashlib
import importlib.util
import json
import re
import sys
import threading
import unicodedata
import urllib.parse
from collections import Counter, defaultdict, deque
from pathlib import Path

spec = importlib.util.spec_from_file_location(
    "holdout_evidence_capture", Path(__file__).with_name("holdout-evidence-capture.py"))
capture_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(capture_module)

DATASET_SHA = capture_module.DATASET_SHA
BASE_EVIDENCE_SHA = "9215e597254f3f4b5b9e90e12e314cd228890fc98de5123015242e11aaa58010"
FREEZE_SHA = "94eaf6d6da3b6fde4ac29da679fbaa364373d0f0769a7e71a51b946b525680dc"
FIREBASE = "https://hacker-news.firebaseio.com/v0/item/"
STATES = {"captured", "http-error", "network-error", "too-large", "metadata-error", "empty"}


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def require(ok, message):
    if not ok:
        raise ValueError(message)


def load_inputs(dataset_path, evidence_path):
    raw, prior = Path(dataset_path).read_bytes(), Path(evidence_path).read_bytes()
    require(sha(raw) == DATASET_SHA and sha(prior) == BASE_EVIDENCE_SHA,
            "Candidate or frozen evidence differs; re-audit rather than overwrite")
    return json.loads(raw), json.loads(prior)


def epoch(value):
    if not isinstance(value, str) or not re.search(r"(?:Z|[+-]\d\d:\d\d)$", value):
        raise ValueError("Missing explicit timezone")
    return datetime.datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()


def title_key(value):
    return " ".join(unicodedata.normalize("NFKC", value).split()).casefold()


def plan(dataset, prior):
    require(prior["datasetSha256"] == DATASET_SHA, "Prior dataset mismatch")
    expected = set(capture_module.jobs_for(dataset))
    prior_jobs = [(r["reportId"], r["role"], r["requestUrl"]) for r in prior["rows"]]
    require(len(prior_jobs) == len(expected) and set(prior_jobs) == expected,
            "Frozen observation roles do not cover the dataset")
    jobs = []
    for r in prior["rows"]:
        require(r["state"] in STATES, "Unexpected frozen observation state")
        if r["state"] == "captured":
            continue
        rid, role, url = r["reportId"], r["role"], r["requestUrl"]
        jobs.append((rid, role, url))
        if role == "hn-item":
            match = re.fullmatch(r"https://hn\.algolia\.com/api/v1/items/([1-9][0-9]*)", url)
            require(match is not None, "Unexpected HN item URL")
            jobs.append((rid, "hn-firebase", FIREBASE + match[1] + ".json"))
    return jobs


def identity(report, observation):
    if observation["state"] != "captured":
        return "unavailable"
    if observation["role"] not in ("hn-item", "hn-firebase"):
        return "not-applicable"
    a = observation["observed"].get("api", {})
    try:
        expected = urllib.parse.parse_qs(urllib.parse.urlsplit(report["url"]).query)["id"][0]
        if str(a.get("id")) != expected or a.get("type") != "story":
            return "mismatch"
        if a.get("deleted") or a.get("dead"):
            return "mismatch"
        if not isinstance(a.get("title"), str) or not isinstance(a.get("url"), str):
            return "mismatch"
        if observation["role"] == "hn-item":
            observed_time = epoch(a["created_at"])
        else:
            if type(a.get("time")) is not int:
                return "mismatch"
            observed_time = a["time"]
        # Deliberately strict: changed URLs are reviewed, not silently normalized away.
        return "matched" if (
            title_key(a["title"]) == title_key(report["title"])
            and a["url"] == report["articleUrl"]
            and observed_time == epoch(report["reportedAt"])
        ) else "mismatch"
    except (ValueError, TypeError, KeyError, IndexError, OverflowError):
        return "mismatch"


def verify(dataset, prior, document):
    jobs = plan(dataset, prior)
    expected = {(rid, role): url for rid, role, url in jobs}
    allowed_hosts = {urllib.parse.urlsplit(url).hostname for _, _, url in capture_module.jobs_for(dataset)}
    allowed_hosts |= capture_module.ALLOWED_EXTRA_HOSTS | {"hacker-news.firebaseio.com"}
    require(document["schemaVersion"] == 1 and document["datasetSha256"] == DATASET_SHA
            and document["baseEvidenceSha256"] == BASE_EVIDENCE_SHA and document["baseFreezeSha256"] == FREEZE_SHA,
            "Follow-up provenance mismatch")
    started, finished = epoch(document["startedAt"]), epoch(document["finishedAt"])
    require(started >= epoch(prior["finishedAt"]) and finished >= started, "Invalid follow-up interval")
    rows = {}
    reports = {r["id"]: r for r in dataset["reports"]}
    for r in document["rows"]:
        key = (r["reportId"], r["role"])
        require(key in expected and key not in rows and r["requestUrl"] == expected[key],
                "Unknown, duplicate or changed follow-up request")
        capture_module.checked_url(r["requestUrl"], allowed_hosts)
        if r["finalUrl"] is not None:
            capture_module.checked_url(r["finalUrl"], allowed_hosts)
        require(r["state"] in STATES and started <= epoch(r["capturedAt"]) <= finished,
                "Invalid observation state or time")
        require(r["status"] is None or type(r["status"]) is int and 100 <= r["status"] <= 599,
                "Invalid HTTP status")
        if r["bytes"] is None:
            require(r["responseSha256"] is None, "Fingerprint without byte count")
        else:
            require(type(r["bytes"]) is int and 0 <= r["bytes"] <= capture_module.MAX_BYTES
                    and isinstance(r["responseSha256"], str)
                    and re.fullmatch(r"[0-9a-f]{64}", r["responseSha256"]) is not None,
                    "Invalid fingerprint")
        if r["state"] == "captured":
            require(r["status"] == 200 and r["finalUrl"] is not None and r["bytes"] is not None
                    and r["bytes"] > 0 and r["error"] is None and isinstance(r["observed"], dict),
                    "Incomplete captured observation")
            if r["role"] in ("hn-item", "hn-firebase"):
                require(isinstance(r["observed"].get("api"), dict), "Missing API metadata")
            else:
                require("title" in r["observed"] and "publishedMetadata" in r["observed"],
                        "Missing page metadata")
        else:
            require(r["observed"] is None, "Failure cannot claim accepted metadata")
            if r["state"] == "network-error":
                require(isinstance(r["error"], str) and bool(r["error"].strip()), "Missing network error")
        rows[key] = r
    require(set(rows) == set(expected), "Incomplete follow-up observations")
    risks, recovered, unresolved, alternative_only = [], [], [], []
    for old in prior["rows"]:
        if old["state"] == "captured":
            continue
        rid, role = old["reportId"], old["role"]
        attempt = rows[(rid, role)]
        match = identity(reports[rid], attempt)
        alt = rows.get((rid, "hn-firebase")) if role == "hn-item" else None
        alt_match = identity(reports[rid], alt) if alt is not None else "not-applicable"
        if "mismatch" in (match, alt_match):
            risks.append({"reportId": rid, "role": role, "retryIdentity": match, "alternateIdentity": alt_match})
        if attempt["state"] == "captured" and match != "mismatch":
            recovered.append({"reportId": rid, "role": role, "identity": match})
        else:
            unresolved.append({"reportId": rid, "role": role, "state": attempt["state"], "identity": match})
            if alt_match == "matched" and match != "mismatch":
                alternative_only.append(rid)
    return {
        "status": "blocked-draft", "automaticAdmission": False,
        "attempts": len(rows), "byRoleState": dict(sorted(Counter(r["role"] + ":" + r["state"] for r in rows.values()).items())),
        "recoveredOriginalPositions": len(recovered), "unresolvedOriginalPositions": len(unresolved),
        "alternateOnlyMatchedHnItems": len(alternative_only),
        "alternateIdentity": dict(sorted(Counter(identity(reports[r["reportId"]], r) for r in rows.values()
                                                  if r["role"] == "hn-firebase").items())),
        "recovered": recovered, "unresolved": unresolved, "alternateOnly": alternative_only, "identityRisks": risks,
        "note": "Current observations only. Alternative API does not replace the original HN evidence role. Historical evidence and human judgments remain pending."
    }


def collect(dataset, prior):
    jobs = plan(dataset, prior)
    hosts = {urllib.parse.urlsplit(url).hostname for _, _, url in capture_module.jobs_for(dataset)}
    hosts |= capture_module.ALLOWED_EXTRA_HOSTS | {"hacker-news.firebaseio.com"}
    semaphores = {host: threading.BoundedSemaphore(2) for host in hosts}
    queues = defaultdict(deque)
    for job in jobs:
        capture_module.checked_url(job[2], hosts)
        queues[urllib.parse.urlsplit(job[2]).hostname].append(job)
    ordered = []
    while any(queues.values()):
        for host in sorted(queues):
            if queues[host]:
                ordered.append(queues[host].popleft())
    started = capture_module.timestamp()
    with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:
        rows = list(pool.map(lambda job: capture_module.capture(job, hosts, semaphores), ordered))
    order = {(rid, role): i for i, (rid, role, _) in enumerate(jobs)}
    rows.sort(key=lambda r: order[(r["reportId"], r["role"])])
    document = {
        "schemaVersion": 1, "datasetSha256": DATASET_SHA, "baseEvidenceSha256": BASE_EVIDENCE_SHA,
        "baseFreezeSha256": FREEZE_SHA, "startedAt": started, "finishedAt": capture_module.timestamp(),
        "purpose": "One retry per failed original position plus alternate public HN item API. Not historical evidence or admission.",
        "rows": rows,
    }
    result = verify(dataset, prior, document)
    return document, result


def main():
    if len(sys.argv) != 5 or sys.argv[1] not in ("capture", "verify"):
        sys.exit("Usage: holdout-evidence-followup.py capture|verify <candidate.json> <frozen-evidence.json> <followup.json>")
    dataset, prior = load_inputs(sys.argv[2], sys.argv[3])
    dest = Path(sys.argv[4])
    if sys.argv[1] == "capture":
        if dest.exists():
            sys.exit("Output exists; refusing to overwrite")
        document, result = collect(dataset, prior)
        with dest.open("x", encoding="utf-8") as out:
            json.dump(document, out, ensure_ascii=False, indent=2)
            out.write("\n")
    else:
        result = verify(dataset, prior, json.loads(dest.read_bytes()))
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
