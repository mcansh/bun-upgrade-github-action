import fs from "node:fs";
import path from "node:path";
import { execa } from "execa";
import * as core from "@actions/core";
import { getOctokit } from "@actions/github";
import NPMCliPackageJson from "@npmcli/package-json";
import { z } from "zod";

async function run(): Promise<void> {
  let schema = z.object({
    GITHUB_REPOSITORY: z.string(),
    GH_TOKEN: z.string(),
    PACKAGE_JSON_PATH: z.string().optional().default("./"),
    IGNORED_DEPENDENCIES: z
      .string()
      .optional()
      .default("")
      .transform((dep) => {
        return dep.split(",").map((d) => d.trim());
      }),
  });

  let env = schema.parse({
    GITHUB_REPOSITORY: core.getInput("GITHUB_REPOSITORY"),
    GH_TOKEN: core.getInput("GH_TOKEN", { required: true }),
    PACKAGE_JSON_PATH: core.getInput("PACKAGE_JSON_PATH"),
    IGNORED_DEPENDENCIES: core.getInput("IGNORED_DEPENDENCIES"),
  });

  let octokit = getOctokit(env.GH_TOKEN);

  let [owner, repo] = env.GITHUB_REPOSITORY.split("/");

  if (!owner || !repo) throw new Error("Invalid GITHUB_REPOSITORY");

  let CWD = path.resolve(env.PACKAGE_JSON_PATH);

  let PACKAGE_JSON = "package.json" as const;
  let BUN_LOCK = "bun.lockb" as const;

  if (path.basename(CWD) === PACKAGE_JSON) {
    CWD = path.dirname(CWD);
  }

  core.debug(`Ignoring dependencies: ${env.IGNORED_DEPENDENCIES.join(", ")}`);

  let json = await NPMCliPackageJson.load(path.resolve(CWD));

  let dependencies = getAllDependencies(json);

  let depsToCheck = Object.keys(dependencies).filter((d) => {
    return !env.IGNORED_DEPENDENCIES.includes(d);
  });

  core.debug(`Dependencies to check: ${depsToCheck.join(", ")}`);

  for (let dep of depsToCheck) {
    core.debug(`Checking ${dep}`);
    // reset to HEAD so we don't commit previous changes
    await execa("git", ["reset", "--hard"], { cwd: CWD, stdio: "inherit" });
    await execa("bun", ["add", dep], { cwd: CWD, stdio: "inherit" });

    let updated = await NPMCliPackageJson.load(path.resolve(CWD));

    let updatedDependencies = getAllDependencies(updated);

    if (dependencies[dep] === updatedDependencies[dep]) {
      core.info(`${dep} is up to date`);
      continue;
    }

    let branchPackageName: string = dep;
    if (dep.startsWith("@")) {
      let unscoped = branchPackageName.replace("@", "").split("/").join("__");
      branchPackageName = unscoped;
    }
    let branch = `bun-dependabot/${branchPackageName}`;

    let lastCommitDeps = await getLastCommitDeps({
      octokit,
      owner,
      repo,
      packageJsonPath: PACKAGE_JSON,
      branch,
    }).catch(() => {
      return {};
    });

    let currentVersion = dependencies[dep];
    let updatedVersion = updatedDependencies[dep];

    if (lastCommitDeps[dep] === updatedVersion) {
      // if there are merge conflicts, bun will address them
      await execa("bun", ["install"], { cwd: CWD, stdio: "inherit" });
      let result = await execa("git", ["status", "--porcelain"]);
      let hasChanges = result.stdout.split("\n").length > 1;
      if (!hasChanges) {
        core.info(`📦 PR already up to date`);
        continue;
      }
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

    let message = `chore(deps): bump ${dep} from ${currentVersion} to ${updatedVersion}`;
    let description = `Bumps ${dep} from ${currentVersion} to ${updatedVersion}.`;

    let commit = await octokit.rest.git.createCommit({
      owner,
      repo,
      message: message + "\n\n" + description,
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
        core.info(`📦 Updating branch ${branch}`);
        await octokit.rest.git.updateRef({
          owner,
          repo,
          ref: REF,
          sha: commit.data.sha,
          force: true,
        });
        continue;
      }

      core.error(`?? existing ref ${existingRef.status}`);
      core.error(JSON.stringify(existingRef));
    } catch (error) {
      core.info(`📦 Creating branch ${branch}`);
      await octokit.rest.git.createRef({
        owner,
        repo,
        ref: FULL_REF,
        sha: commit.data.sha,
      });
    }

    let existingPRs = await octokit.rest.pulls.list({
      owner,
      repo,
      head: `${owner}:${branch}`,
      base: "main", // TODO: get default branch
      state: "open",
      sort: "updated",
    });

    let existingPR = existingPRs.data.at(1);

    if (existingPR) {
      if (lastCommitDeps[dep] === updatedVersion) {
        core.info(`📦 PR is already up to date, we can close this one`);
        await octokit.rest.pulls.update({
          owner,
          repo,
          pull_number: existingPR.number,
          state: "closed",
        });
        continue;
      }

      core.info(`📦 PR already exists for ${dep}`);

      await octokit.rest.pulls.update({
        owner,
        repo,
        pull_number: existingPR.number,
        title: `test: ${message}`,
        body: description,
      });

      continue;
    }

    let pr = await octokit.rest.pulls.create({
      owner,
      repo,
      base: "main",
      head: FULL_REF,
      title: message,
      body: description,
    });

    core.info(`💿 Created PR ${pr.data.html_url}`);
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

async function getLastCommitDeps({
  octokit,
  branch,
  owner,
  packageJsonPath,
  repo,
}: {
  octokit: ReturnType<typeof getOctokit>;
  owner: string;
  repo: string;
  packageJsonPath: string;
  branch: string;
}) {
  let lastCommitToBranch = await octokit.rest.repos.getContent({
    owner,
    repo,
    path: packageJsonPath,
    ref: branch,
    mediaType: { format: "raw" },
  });
  let lastCommitPackageJson = JSON.parse(lastCommitToBranch.data.toString());

  let lastCommitDeps = {
    ...lastCommitPackageJson.dependencies,
    ...lastCommitPackageJson.devDependencies,
  };

  return lastCommitDeps;
}

run().catch((error) => {
  core.setFailed(error.message);
});
