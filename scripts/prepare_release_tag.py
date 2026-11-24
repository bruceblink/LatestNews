"""为手动发布创建或复用已校验的远端版本标签。"""

import argparse
import json
import os
import re
import subprocess


class TagPreparationError(RuntimeError):
    """表示版本标签无法安全创建或复用。"""


SEMVER = re.compile(
    r"v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)"
    r"(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?"
)


def require(condition, message):
    if not condition:
        raise TagPreparationError(message)


def command(*args):
    """执行只读 Git 命令，并保留可诊断的失败信息。"""
    try:
        return subprocess.check_output(args, text=True, stderr=subprocess.PIPE).strip()
    except subprocess.CalledProcessError as exc:
        raise TagPreparationError(f"命令失败: {' '.join(args)}") from exc


def validate_tag(tag):
    require(SEMVER.fullmatch(tag) is not None, "发布标签必须使用 v1.2.3 或 v1.2.3-rc.1 格式")


def current_commit():
    return command("git", "rev-parse", "HEAD")


def package_version(commit):
    try:
        package = json.loads(command("git", "show", f"{commit}:package.json"))
    except (json.JSONDecodeError, TagPreparationError) as exc:
        raise TagPreparationError("无法读取目标提交的 package.json 版本") from exc
    version = package.get("version")
    require(isinstance(version, str) and version, "目标提交缺少有效的 package.json version")
    return version


def remote_commit(tag):
    """读取轻量标签或附注标签指向的提交；标签不存在时返回 None。"""
    result = subprocess.run(
        ["git", "ls-remote", "origin", f"refs/tags/{tag}", f"refs/tags/{tag}^{{}}"],
        text=True,
        capture_output=True,
        check=False,
    )
    if result.returncode == 0 and not result.stdout.strip():
        return None
    if result.returncode == 2 and not result.stdout.strip():
        return None
    if result.returncode != 0:
        raise TagPreparationError("无法读取远端标签；请检查网络和 Git 凭据")
    refs = {}
    for line in result.stdout.splitlines():
        sha, name = line.split("\t", 1)
        require(re.fullmatch(r"[0-9a-f]{40}", sha) and name not in refs, "远端标签响应无效")
        refs[name] = sha
    ref = f"refs/tags/{tag}"
    require(ref in refs, "远端标签响应缺少目标引用")
    return refs.get(ref + "^{}", refs[ref])


def create_tag(repo, tag, commit):
    token = os.environ.get("RELEASE_TAG_TOKEN", "")
    require(token, "缺少 RELEASE_TAG_TOKEN；请配置具有 Contents: write 的仓库 Secret")
    payload = json.dumps({"ref": f"refs/tags/{tag}", "sha": commit})
    env = os.environ.copy()
    env["GH_TOKEN"] = token
    # 只允许专用标签令牌创建引用，不把管理令牌用于写操作。
    env.pop("RELEASE_ADMIN_TOKEN", None)
    try:
        subprocess.run(
            ["gh", "api", "--method", "POST", f"repos/{repo}/git/refs", "--input", "-"],
            input=payload,
            text=True,
            env=env,
            check=True,
        )
    except subprocess.CalledProcessError as exc:
        raise TagPreparationError(
            f"无法创建远端标签 {tag}；请确认令牌具有 Contents: write 且被允许创建标签"
        ) from exc


def prepare(repo, tag):
    """校验版本并创建或复用指向当前提交的远端标签。"""
    validate_tag(tag)
    existing = remote_commit(tag)
    if existing is not None:
        require(tag == f"v{package_version(existing)}", "标签版本与目标提交的 package.json version 不一致")
        return existing, False
    commit = current_commit()
    require(tag == f"v{package_version(commit)}", "标签版本与目标提交的 package.json version 不一致")
    create_tag(repo, tag, commit)
    require(remote_commit(tag) == commit, "标签创建后无法确认其提交指向")
    return commit, True


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("tag")
    args = parser.parse_args()
    commit, created = prepare(os.environ["GITHUB_REPOSITORY"], args.tag)
    output = os.environ.get("GITHUB_OUTPUT")
    if output:
        with open(output, "a", encoding="utf-8") as stream:
            stream.write(f"commit={commit}\ncreated={'true' if created else 'false'}\n")
    action = "Created" if created else "Reused"
    print(f"{action} remote release tag {args.tag}: {commit}")


if __name__ == "__main__":
    try:
        main()
    except TagPreparationError as exc:
        raise SystemExit(str(exc)) from exc
