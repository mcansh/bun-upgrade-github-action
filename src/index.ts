import fs from "node:fs";
import path from "node:path";
import cp from "node:child_process";
import * as core from "@actions/core";

import { getOctokit } from "@actions/github";
import NPMCliPackageJson from "@npmcli/package-json";

async function run(): Promise<void> {
  let token = core.getInput("GH_TOKEN", { required: true });
  let octokit = getOctokit(token);

  let GITHUB_REPOSITORY = core.getInput("GITHUB_REPOSITORY");
  let [owner, repo] = GITHUB_REPOSITORY.split("/");

  let ignored = core.getInput("IGNORED_DEPENDENCIES");
  let deps = ignored.split(",").map((d) => d.trim());

  let packageJsonInput = core.getInput("PACKAGE_JSON_PATH", {
    trimWhitespace: true,
  });

  if (!packageJsonInput) {
    packageJsonInput = "./";
  }

  if (packageJsonInput.endsWith("package.json")) {
    packageJsonInput = path.dirname(packageJsonInput);
  }

  core.debug(`Ignoring dependencies: ${deps.join(", ")}`);

  let json = await NPMCliPackageJson.load(path.resolve(packageJsonInput));

  let dependencies = getAllDependencies(json);

  let depsToCheck = Object.keys(dependencies).filter((d) => !deps.includes(d));

  core.debug(`Dependencies to check: ${depsToCheck.join(", ")}`);

  await Promise.all(
    depsToCheck.map(async (dep) => {
      core.debug(`Checking ${dep}`);
      cp.execSync(`bun add ${dep}`, { stdio: "inherit" });

      let updated = await NPMCliPackageJson.load(
        path.resolve(packageJsonInput),
      );

      let updatedDependencies = getAllDependencies(updated);

      if (dependencies[dep] === updatedDependencies[dep]) {
        core.debug(`${dep} is up to date`);
        return;
      }

      let branch = `bun-dependabot/${dep}`;

      let bunContent = fs.readFileSync(
        path.join(packageJsonInput, "bun.lockb"),
      );

      let [bunBlob, packageJsonBlob] = await Promise.all([
        octokit.rest.git.createBlob({
          owner,
          repo,
          content: bunContent.toString(),
          encoding: "utf-8",
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
            path: "bun.lockb",
            mode: "100644",
            type: "blob",
          },
          {
            sha: packageJsonBlob.data.sha,
            path: "package.json",
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

      await octokit.rest.git.updateRef({
        owner,
        repo,
        ref: `heads/${branch}`,
        sha: commit.data.sha,
      });

      let pr = await octokit.rest.pulls.create({
        owner,
        repo,
        base: "main",
        head: branch,
        title: `Update ${dep} to latest version`,
        body: `This PR updates ${dep} to the latest version.`,
      });

      console.log(`💿 Created PR ${pr.data.url}`);
    }),
  );
}

function getAllDependencies(packageJson: NPMCliPackageJson) {
  let dependencies = packageJson.content.dependencies;
  let devDependencies = packageJson.content.devDependencies;
  let peerDependencies = packageJson.content.peerDependencies;
  let optionalDependencies = packageJson.content.optionalDependencies;

  return {
    ...dependencies,
    ...devDependencies,
    ...peerDependencies,
    ...optionalDependencies,
  };
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
