<!-- ACTION-INPUT-LIST:START -->

### ⚙️ Inputs
| Name                 | Default                  | Description                                                  | Required |
| -------------------- | ------------------------ | ------------------------------------------------------------ | -------- |
| IGNORED_DEPENDENCIES | undefined                | dependencies to ignore                                       | false    |
| PACKAGE_JSON_PATH    | undefined                | path to package.json if not in root directory                | false    |
| GITHUB_REPOSITORY    | ${{ github.repository }} | The GitHub repository - needed for creating and logging urls | false    |
| GH_TOKEN             | ${{ github.token }}      | The GitHub token to use for interacting with the GitHub API  | false    |

<!-- ACTION-INPUT-LIST:END -->
