import { parse } from "yaml";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createReadStream } from "node:fs";
import { join, resolve, basename } from "node:path";
import { stat, readdir, readFile, writeFile } from "node:fs/promises";

async function hash(path, algorithm, encoding) {
  const digest = createHash(algorithm);
  for await (const chunk of createReadStream(path)) {
    digest.update(chunk);
  }
  return digest.digest(encoding);
}

async function listFiles(root) {
  const files = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFiles(path));
    }
    else {
      files.push(path);
    }
  }
  return files;
}

/** Validate the actual assets before a Release advertises them as downloadable updates. */
export async function verifyUpdateAssets(root, { version, expectedMetadata = ["latest.yml", "latest-mac.yml", "latest-linux.yml"] }) {
  const paths = await listFiles(root);
  const byName = new Map();
  for (const path of paths) {
    const name = basename(path);
    if (byName.has(name)) {
      throw new Error(`Duplicate release asset: ${name}`);
    }
    byName.set(name, path);
  }
  for (const name of expectedMetadata) {
    const path = byName.get(name);
    if (!path) {
      throw new Error(`Missing update metadata: ${name}`);
    }
    const info = parse(await readFile(path, "utf8"));
    if (info.version !== version || !Array.isArray(info.files) || info.files.length === 0) {
      throw new Error(`Invalid version or files in ${name}`);
    }
    for (const file of info.files) {
      if (typeof file.url !== "string" || basename(file.url) !== file.url || !byName.has(file.url)) {
        throw new Error(`Missing or unsafe update file in ${name}`);
      }
      const asset = byName.get(file.url);
      if ((await stat(asset)).size !== file.size || await hash(asset, "sha512", "base64") !== file.sha512) {
        throw new Error(`Update file size or SHA-512 mismatch: ${file.url}`);
      }
      if (/\.(exe|zip)$/.test(file.url) && !byName.has(`${file.url}.blockmap`)) {
        throw new Error(`Missing differential block map: ${file.url}`);
      }
    }
  }
  const checksumPaths = paths.filter(path => /\.(exe|dmg|zip|AppImage|deb|blockmap|yml)$/.test(path)).sort();
  const lines = [];
  for (const path of checksumPaths) {
    lines.push(`${await hash(path, "sha256", "hex")}  ${basename(path)}`);
  }
  await writeFile(join(root, "SHA256SUMS.txt"), `${lines.join("\n")}\n`, "utf8");
  return checksumPaths.length;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { version } = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const count = await verifyUpdateAssets(resolve(process.argv[2] ?? "desktop"), { version });
  console.info(`Verified update metadata and ${count} release assets.`);
}
