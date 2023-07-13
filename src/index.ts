import path from "node:path";
import cp from "node:child_process";
import * as core from "@actions/core";
import { createOrUpdateTextFile as ogCreateOrUpdateTextFile } from "@octokit/plugin-create-or-update-text-file";
import { getOctokit } from "@actions/github";
import NPMCliPackageJson from "@npmcli/package-json";

async function run(): Promise<void> {
  let token = core.getInput("GH_TOKEN", { required: true });
  let octokit = getOctokit(token);
  let { createOrUpdateTextFile } = ogCreateOrUpdateTextFile(octokit);

  let GITHUB_REPOSITORY = core.getInput("GITHUB_REPOSITORY");
  let [owner, repo] = GITHUB_REPOSITORY.split("/");

  let ignored = core.getInput("IGNORED_DEPENDENCIES", { trimWhitespace: true });
  let deps = ignored.split(",").map((d) => d.trim());

  let packageJsonInput = core.getInput("PACKAGE_JSON_PATH", {
    trimWhitespace: true,
  });

  if (!packageJsonInput) {
    packageJsonInput = "./";
  }

  if (packageJsonInput.endsWith("package.json")) {
    packageJsonInput = packageJsonInput.slice(0, "package.json".length + 1);
  }

  core.debug(`Ignoring dependencies: ${deps.join(", ")}`);

  // let packageJson = await fs.readFile(path.resolve(packageJsonInput), "utf8");
  // let json = JSON.parse(packageJson);

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

      let author = {
        email: "github-actions[bot]@users.noreply.github.com",
        name: "github-actions[bot]",
      };

      await Promise.all([
        createOrUpdateTextFile({
          owner,
          repo,
          path: "package.json",
          content: JSON.stringify(json, null, 2),
          message: `Update ${dep} to latest version`,
          author: author,
          committer: author,
          branch,
        }),
        createOrUpdateTextFile({
          owner,
          repo,
          path: "bun.lockb",
          content: JSON.stringify(json, null, 2),
          message: `Update ${dep} to latest version`,
          author: author,
          committer: author,
          branch,
        }),
      ]);
      octokit.rest.pulls.create({
        owner,
        repo,
        base: "main",
        head: branch,
        title: `Update ${dep} to latest version`,
        body: `This PR updates ${dep} to the latest version.`,
      });
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
