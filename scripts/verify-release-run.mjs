import { execFileSync } from "node:child_process";

const [runId, ...requiredJobs] = process.argv.slice(2);
if (!/^\d+$/.test(runId ?? "") || requiredJobs.length === 0) {
    throw new Error("A release run ID and required job names are required.");
}
const run = JSON.parse(
    execFileSync(
        "gh",
        ["run", "view", runId, "--repo", process.env.GITHUB_REPOSITORY, "--json", "headSha,jobs"],
        { encoding: "utf8" }
    )
);
const head = execFileSync("git", ["rev-parse", `${process.env.RELEASE_TAG ?? "HEAD"}^{commit}`], {
    encoding: "utf8",
}).trim();
if (run.headSha !== head) throw new Error("Recovered artifacts do not belong to the checked-out release tag.");
for (const name of requiredJobs) {
    const job = run.jobs.find((job) => job.name === name);
    if (!job || job.status !== "completed" || job.conclusion !== "success") {
        throw new Error(`Required source job has not succeeded: ${name}`);
    }
}
console.info(`Verified source commit and ${requiredJobs.length} required jobs for release run ${runId}.`);
