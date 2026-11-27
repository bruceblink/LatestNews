#!/usr/bin/env python3
"""Read-only current public evidence capture for the pinned expanded N4-N draft.

No full article/comment bodies are retained. Response hashes refer to the bytes
read during this run, not to the historical RSS responses. No scoring or labels.
"""
import concurrent.futures
import datetime
import hashlib
import html.parser
import http.client
import json
import re
import sys
import threading
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

DATASET_SHA = "43fd4e225559996704ecc6fd504a152c7b4011325ca6b2ca2cdd5b90f5671c79"
MAX_BYTES = 2 * 1024 * 1024
TIMEOUT = 8
AGENT = "LatestNewsOfflineEvidenceAudit/1.0"
ALLOWED_EXTRA_HOSTS = {"itsfoss.com", "www.itsfoss.com"}
TIME_KEYS = {"article:published_time", "og:published_time", "datepublished", "publishdate", "pubdate", "date", "dc.date.issued"}


def timestamp():
    return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")


def checked_url(value, hosts):
    u = urllib.parse.urlsplit(value)
    if u.scheme != "https" or u.hostname not in hosts or u.username or u.password or u.port not in (None, 443):
        raise ValueError("URL outside fixed public host allowlist")
    return value


class Redirects(urllib.request.HTTPRedirectHandler):
    max_redirections = 4
    max_repeats = 2

    def __init__(self, hosts):
        self.hosts = hosts

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        checked_url(newurl, self.hosts)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


class Metadata(html.parser.HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.in_head = False
        self.in_title = False
        self.title_seen = False
        self.title = []
        self.published = []

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "head":
            self.in_head = True
        elif tag == "body":
            self.in_head = False
            self.in_title = False
        elif tag == "title" and self.in_head and not self.title_seen:
            self.in_title = True
            self.title_seen = True
        elif tag == "meta" and self.in_head:
            key = (a.get("property") or a.get("name") or a.get("itemprop") or "").lower()
            value = a.get("content")
            if key in TIME_KEYS and value and len(value) <= 160:
                self.published.append({"field": key, "value": value})
        elif tag == "time" and a.get("datetime") and len(a["datetime"]) <= 160:
            self.published.append({"field": "time.datetime", "value": a["datetime"]})

    def handle_endtag(self, tag):
        if tag == "title":
            self.in_title = False
        elif tag == "head" or tag == "body":
            self.in_head = False
            self.in_title = False

    def handle_data(self, data):
        if self.in_title:
            self.title.append(data)


def observed_metadata(body, content_type, role):
    if role in ("hn-item", "hn-firebase", "release-api"):
        raw = json.loads(body)
        if not isinstance(raw, dict):
            raise ValueError("API response is not an object")
        fields = (
            ("id", "type", "title", "url", "created_at")
            if role == "hn-item"
            else ("id", "type", "title", "url", "time", "deleted", "dead")
            if role == "hn-firebase"
            else ("id", "name", "tag_name", "published_at", "html_url", "draft", "prerelease")
        )
        # Restrict the retained evidence to scalar identity/time metadata.
        return {"api": {k: raw[k] for k in fields if k in raw and (raw[k] is None or isinstance(raw[k], (str, int, bool))) }}
    if "html" not in content_type.lower() and not body.lstrip().startswith(b"<"):
        return {"title": None, "publishedMetadata": [], "solidotWallTime": None}
    parser = Metadata()
    text = body.decode("utf-8", errors="replace")
    parser.feed(text)
    title = " ".join("".join(parser.title).split())[:500] or None
    matches = sorted(set(re.findall(r"发表于\s*(\d{4})年(\d{1,2})月(\d{1,2})日\s+(\d{1,2})时(\d{1,2})分", text)))
    wall = None
    if len(matches) == 1:
        y, m, d, h, minute = map(int, matches[0])
        wall = f"{y:04d}-{m:02d}-{d:02d} {h:02d}:{minute:02d}"
    return {"title": title, "publishedMetadata": parser.published[:12], "solidotWallTime": wall}


def capture(job, hosts, semaphores):
    report_id, role, url = job
    result = {"reportId": report_id, "role": role, "requestUrl": url, "status": None,
              "finalUrl": None, "bytes": None, "responseSha256": None, "contentType": None,
              "observed": None, "state": "network-error", "error": None}
    with semaphores[urllib.parse.urlsplit(url).hostname]:
        try:
            opener = urllib.request.build_opener(Redirects(hosts))
            request = urllib.request.Request(checked_url(url, hosts), headers={"User-Agent": AGENT, "Accept-Encoding": "identity"})
            with opener.open(request, timeout=TIMEOUT) as response:
                result["status"] = response.status
                result["finalUrl"] = checked_url(response.geturl(), hosts)
                result["contentType"] = response.headers.get("Content-Type")
                if response.status != 200:
                    result["state"] = "http-error"
                else:
                    body = response.read(MAX_BYTES + 1)
                    if len(body) > MAX_BYTES:
                        result["state"] = "too-large"
                    else:
                        result["bytes"] = len(body)
                        result["responseSha256"] = hashlib.sha256(body).hexdigest()
                        try:
                            if body:
                                result["observed"] = observed_metadata(body, result["contentType"] or "", role)
                                result["state"] = "captured"
                            else:
                                result["state"] = "empty"
                        except (ValueError, TypeError, UnicodeError, json.JSONDecodeError):
                            result["state"] = "metadata-error"
        except urllib.error.HTTPError as exc:
            result["status"] = exc.code
            try:
                result["finalUrl"] = checked_url(exc.geturl(), hosts)
                result["state"] = "http-error"
            except ValueError:
                result["state"] = "network-error"
                result["error"] = "RedirectOutsideAllowlist"
            exc.close()
        except (OSError, ValueError, urllib.error.URLError, http.client.HTTPException) as exc:
            result["error"] = type(exc).__name__
        finally:
            result["capturedAt"] = timestamp()
    return result


def jobs_for(dataset):
    jobs = []
    for report in dataset["reports"]:
        rid = report["id"]
        jobs.append((rid, "article", report["articleUrl"]))
        if report["timeKind"] == "submission":
            jobs.append((rid, "discussion", report["url"]))
            jobs.append((rid, "hn-item", report["evidenceUrl"]))
        elif report["source"] == "github-release":
            jobs.append((rid, "release-api", report["evidenceUrl"]))
        # Historical RSS feeds are mutable. Do not replay a new feed as evidence.
    return jobs


def refresh_truncated_titles(dataset_path, prior_path, output_path):
    raw = Path(dataset_path).read_bytes()
    if hashlib.sha256(raw).hexdigest() != DATASET_SHA:
        raise ValueError("Expected pinned expanded candidate")
    prior = json.loads(Path(prior_path).read_bytes())
    if prior["datasetSha256"] != DATASET_SHA or prior.get("supersededObservations"):
        raise ValueError("Expected original capture")
    dataset = json.loads(raw)
    expected = set(jobs_for(dataset))
    old_jobs = [(r["reportId"], r["role"], r["requestUrl"]) for r in prior["rows"]]
    if len(old_jobs) != len(expected) or set(old_jobs) != expected:
        raise ValueError("Original observation set differs from pinned dataset")
    hosts = {urllib.parse.urlsplit(url).hostname for _, _, url in expected} | ALLOWED_EXTRA_HOSTS
    semaphores = {host: threading.BoundedSemaphore(2) for host in hosts}
    affected = [r for r in prior["rows"] if r["role"] == "article" and len((r.get("observed") or {}).get("title") or "") == 500]
    if not affected:
        raise ValueError("No truncated title observations")
    jobs = [(r["reportId"], r["role"], r["requestUrl"]) for r in affected]
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        replacements = list(pool.map(lambda j: capture(j, hosts, semaphores), jobs))
    by_key = {(r["reportId"], r["role"]): r for r in replacements}
    prior["supersededObservations"] = affected
    prior["rows"] = [by_key.get((r["reportId"], r["role"]), r) for r in prior["rows"]]
    prior["finishedAt"] = timestamp()
    prior["refreshReason"] = "Original extractor joined document and inline SVG title elements; targeted re-capture after head-title parser correction."
    with Path(output_path).open("x", encoding="utf-8") as out:
        json.dump(prior, out, ensure_ascii=False, indent=2)
        out.write("\n")
    from collections import Counter
    print(json.dumps({"refreshed": len(replacements), "states": Counter(r["state"] for r in replacements)}))


def main(dataset_path, output_path):
    raw = Path(dataset_path).read_bytes()
    if hashlib.sha256(raw).hexdigest() != DATASET_SHA:
        raise ValueError("Expected the pinned expanded candidate; re-audit before collecting different URLs")
    dataset = json.loads(raw)
    jobs = jobs_for(dataset)
    hosts = {urllib.parse.urlsplit(url).hostname for _, _, url in jobs} | ALLOWED_EXTRA_HOSTS
    for _, _, url in jobs:
        checked_url(url, hosts)
    semaphores = {host: threading.BoundedSemaphore(2) for host in hosts}
    # Interleave hosts so one slow source does not block all workers.
    from collections import defaultdict, deque
    queues = defaultdict(deque)
    for job in jobs:
        queues[urllib.parse.urlsplit(job[2]).hostname].append(job)
    ordered = []
    while any(queues.values()):
        for host in sorted(queues):
            if queues[host]:
                ordered.append(queues[host].popleft())
    started = timestamp()
    with concurrent.futures.ThreadPoolExecutor(max_workers=16) as pool:
        futures = [pool.submit(capture, job, hosts, semaphores) for job in ordered]
        rows = []
        for future in concurrent.futures.as_completed(futures):
            rows.append(future.result())
            if len(rows) % 25 == 0:
                print(f"captured {len(rows)}/{len(jobs)} attempts", file=sys.stderr, flush=True)
    order = {(rid, role): i for i, (rid, role, _) in enumerate(jobs)}
    rows.sort(key=lambda r: order[(r["reportId"], r["role"])])
    document = {"schemaVersion": 1, "datasetSha256": DATASET_SHA,
                "purpose": "Current public evidence metadata only; not historical raw response retention or human judgments.",
                "startedAt": started, "finishedAt": timestamp(), "maxBytes": MAX_BYTES, "socketTimeoutSeconds": TIMEOUT,
                "rows": rows}
    with Path(output_path).open("x", encoding="utf-8") as out:
        json.dump(document, out, ensure_ascii=False, indent=2)
        out.write("\n")
    from collections import Counter
    print(json.dumps({"attempts": len(rows), "states": Counter(r["state"] for r in rows)}, ensure_ascii=False))


if __name__ == "__main__":
    if len(sys.argv) == 3:
        main(*sys.argv[1:])
    elif len(sys.argv) == 5 and sys.argv[1] == "refresh-truncated-titles":
        refresh_truncated_titles(*sys.argv[2:])
    else:
        sys.exit("Usage: holdout-evidence-capture.py <pinned-dataset.json> <new-evidence.json> | refresh-truncated-titles <pinned-dataset.json> <prior-evidence.json> <new-evidence.json>")
