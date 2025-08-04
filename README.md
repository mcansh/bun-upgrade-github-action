# Bun Upgrade GitHub Action

> automatically update your dependencies using bun

## Usage
```yaml
name: 📦 Check for updates
on:
  push:
    branches:
      - main
    paths:
      - ./package.json
      - ./bun.lockb

permissions:
  contents: write
  pull-requests: write

jobs:
  deps:
    runs-on: ubuntu-latest
    steps:
      - name: ⬇️ Checkout repo
        uses: actions/checkout@v4

      - name: Setup Bun
        uses: oven-sh/setup-bun@v2
        with:
          bun-version: "1.x"

      - name: 📦 Check for updates
        uses: mcansh/bun-upgrade-github-action@v1
```

<!-- ACTION-INPUT-LIST:START -->

### ⚙️ Inputs
| Name                 | Default                  | Description                                                  | Required |
| -------------------- | ------------------------ | ------------------------------------------------------------ | -------- |
| IGNORED_DEPENDENCIES | undefined                | dependencies to ignore                                       | false    |
| PACKAGE_JSON_PATH    | undefined                | path to package.json if not in root directory                | false    |
| GITHUB_REPOSITORY    | ${{ github.repository }} | The GitHub repository - needed for creating and logging urls | false    |
| GH_TOKEN             | ${{ github.token }}      | The GitHub token to use for interacting with the GitHub API  | false    |

<!-- ACTION-INPUT-LIST:END -->
