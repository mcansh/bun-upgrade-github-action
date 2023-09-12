import fs from "node:fs";
import path from "node:path";
import cp from "node:child_process";
import * as core from "@actions/core";
import { getOctokit } from "@actions/github";
import NPMCliPackageJson from "@npmcli/package-json";
import { z } from "zod";

async function run(): Promise<void> {
  let schema = z.object({
    GITHUB_REPOSITORY: z.string(),
    GH_TOKEN: z.string(),
    PACKAGE_JSON_PATH: z.string().optional().default("./"),
    IGNORED_DEPENDENCIES: z.string().optional().default(""),
  });

  let env = schema.parse({
    GITHUB_REPOSITORY: core.getInput("GITHUB_REPOSITORY"),
    GH_TOKEN: core.getInput("GH_TOKEN", { required: true }),
    PACKAGE_JSON_PATH: core.getInput("PACKAGE_JSON_PATH"),
    IGNORED_DEPENDENCIES: core.getInput("IGNORED_DEPENDENCIES"),
  });

  let octokit = getOctokit(env.GH_TOKEN);

  let [owner, repo] = env.GITHUB_REPOSITORY.split("/");

  if (!owner || !repo) throw new Error(`Invalid GITHUB_REPOSITORY`);

  let ignoredDeps = env.IGNORED_DEPENDENCIES.split(",").map((d) => d.trim());

  let CWD = path.resolve(env.PACKAGE_JSON_PATH);

  let PACKAGE_JSON = "package.json" as const;
  let BUN_LOCK = "bun.lockb" as const;

  if (CWD.endsWith(PACKAGE_JSON)) CWD = path.dirname(CWD);

  core.debug(`Ignoring dependencies: ${ignoredDeps.join(", ")}`);

  let json = await NPMCliPackageJson.load(path.resolve(CWD));

  let dependencies = getAllDependencies(json);

  let depsToCheck = Object.keys(dependencies).filter((d) => {
    return !ignoredDeps.includes(d);
  });

  core.debug(`Dependencies to check: ${depsToCheck.join(", ")}`);

  for (let dep of depsToCheck) {
    core.debug(`Checking ${dep}`);
    // reest to HEAD so we don't commit previous changes
    cp.execSync(`git reset --hard`, { stdio: "inherit" });
    cp.execSync(`bun add ${dep}`, { stdio: "inherit" });

    let updated = await NPMCliPackageJson.load(path.resolve(CWD));

    let updatedDependencies = getAllDependencies(updated);

    if (dependencies[dep] === updatedDependencies[dep]) {
      core.debug(`${dep} is up to date`);
      continue;
    }

    let branch = `bun-dependabot/${dep}`;

    let lastCommitToBranch = await octokit.rest.repos.getContent({
      owner,
      repo,
      path: PACKAGE_JSON,
      ref: branch,
      mediaType: { format: "raw" },
    });

    let lastCommitPackageJson = JSON.parse(lastCommitToBranch.data.toString());

    let lastCommitDeps = {
      ...lastCommitPackageJson.dependencies,
      ...lastCommitPackageJson.devDependencies,
    };

    if (lastCommitDeps[dep] === updatedDependencies[dep]) {
      console.log(`📦 PR already up to date`);
      continue;
    }

    let bunContent = fs.readFileSync(path.join(CWD, BUN_LOCK), "base64");

    let [bunBlob, packageJsonBlob] = await Promise.all([
      octokit.rest.git.createBlob({
        owner,
        repo,
        content: bunContent,
        encoding: "base64",
      }),
      octokit.rest.git.createBlob({
        owner,
        repo,
        content: JSON.stringify(updated.content, null, 2),
        encoding: "utf-8",
      }),
    ]);

    let latestCommit = await octokit.rest.git.getRef({
      owner,
      repo,
      ref: "heads/main", // TODO: get default branch
    });

    let tree = await octokit.rest.git.createTree({
      owner,
      repo,
      base_tree: latestCommit.data.object.sha,
      tree: [
        {
          sha: bunBlob.data.sha,
          path: BUN_LOCK,
          mode: "100644",
          type: "blob",
        },
        {
          sha: packageJsonBlob.data.sha,
          path: PACKAGE_JSON,
          mode: "100644",
          type: "blob",
        },
      ],
    });

    let commit = await octokit.rest.git.createCommit({
      owner,
      repo,
      message: `Update ${dep} to latest version`,
      tree: tree.data.sha,
      parents: [latestCommit.data.object.sha],
      author: {
        email: "github-actions[bot]@users.noreply.github.com",
        name: "github-actions[bot]",
      },
    });

    let REF = `heads/${branch}` as const;
    let FULL_REF = `refs/${REF}` as const;

    try {
      let existingRef = await octokit.rest.git.getRef({
        owner,
        repo,
        ref: REF,
      });

      if (existingRef.status === 200) {
        console.log(`📦 Updating branch ${branch}`);
        await octokit.rest.git.updateRef({
          owner,
          repo,
          ref: REF,
          sha: commit.data.sha,
          force: true,
        });
        continue;
      }

      console.error(`?? existing ref ${existingRef.status}`, existingRef);
    } catch (error) {
      console.log(`📦 Creating branch ${branch}`);
      await octokit.rest.git.createRef({
        owner,
        repo,
        ref: FULL_REF,
        sha: commit.data.sha,
      });
    }

    let existingPR = await octokit.rest.pulls.list({
      owner,
      repo,
      head: `${owner}:${branch}`,
      base: "main", // TODO: get default branch
      state: "open",
    });

    if (existingPR.data.length > 0) {
      console.log(`📦 PR already exists for ${dep}`);
      continue;
    }

    let pr = await octokit.rest.pulls.create({
      owner,
      repo,
      base: "main",
      head: FULL_REF,
      title: `Update ${dep} to latest version`,
      body: `This PR updates ${dep} to the latest version.`,
    });
    console.log(`💿 Created PR ${pr.data.html_url}`);
    continue;
  }
}

function getAllDependencies(packageJson: NPMCliPackageJson) {
  let dependencies = packageJson.content.dependencies;
  let devDependencies = packageJson.content.devDependencies;

  return {
    ...dependencies,
    ...devDependencies,
  };
}

run().then(
  () => {
    process.exit(0);
  },
  (error: unknown) => {
    if (error) console.error(error);
    process.exit(1);
  },
);
