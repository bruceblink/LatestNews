# LatestNews Cloud Workflow

## GitHub Actions and blocked-task monitoring

- Delegate repeated GitHub Actions monitoring to a dedicated subagent. Record the repository, workflow run identifier, head revision, and job identifiers before monitoring.
- Delegate monitoring of a blocked task or an external dependency to a dedicated subagent when the condition needs repeated checks. Continue independent work in the main session and consume only meaningful state changes.
- Monitoring subagents must not modify repository files, configuration files, or task state. They report completion, failure details, the blocking condition, or the user action required. Stop monitoring when the run or blocking condition is resolved.
