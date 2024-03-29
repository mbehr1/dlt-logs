# Build details

## Local builds

To build locally you do need:

once:
```
(have at least nodejs >=12 installed)
npm install -g typescript
npm install -g vsce
npm install
````
then
```
vsce package
```
and you can install your own generated package (dlt-logs-...vsix).

## Creating a PR

After testing your changes locally you can simply create a PR the usual github way.
Please use branch name "feature/..." or "feat/..." for features and "fix/..." for fixes.

## Run end-to-end tests:

There is a set of end-to-end tests that you can run via:

```
npm run e2etests
```

in case of failures there are some screenshots of the failed test in
```
test/screenshots
```

The tests are defined in
```
test/specs
```

## CI setup

I describe the setup here that is used to build and release versions.
The releases are generated automatically in CI.

The following steps are done:
- enforce commit message rules to be able to
  - autogenerate changelog (via semantic-release)
  - automatically define the version (via semantic-release)
- on push to master branch: generate and publish a new release.

### Commit message rules

The [conventional commits](https://www.conventionalcommits.org/en/v1.0.0/) rules are used.

commitlint is used:
```sh
npm install --save-dev @commitlint/{cli,config-conventional}
```

We use the config in the package.json (as we use git hooks ... later as well):
```json
 "commitlint": {
    "extends": [
      "@commitlint/config-conventional"
    ]
  }
```

Husky v6 is used for easy git commit hooks on local setup:
```sh
npm install --save-dev husky
or 
yarn add -D husky
```
and activated in package.json as well:
```json
"scripts": {
  "prepare": "husky install",
  ...
```
and
```sh
npx husky add .husky/commit-msg 'npx --no-install commitlint --edit "$1"' 
```

activated as github action (see file `.github/workflows/commitlint.yml`)
```yml
name: Lint Commit Messages
on:
  push:
    # release.yml workflow does it already there.
    branches-ignore:
      - master
      - gh-pages
  pull_request:
jobs:
  commitlint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
        with:
          fetch-depth: 0
      - uses: wagoid/commitlint-github-action@v2
```

### Semantic release

Semantic-release is used to
 - determine the next semantic version based on the commit messages and last version tag
 - create/update release notes / CHANGELOG.md
 - update package.json version
 - create a github release tag/version

```sh
npm install --save-dev semantic-release @semantic-release/changelog @semantic-release/git
npm install --save-dev semantic-release-vsce
```
and configured in package.json via:
```json
"release": {
    "branches": [
      "master"
    ],
    "plugins": [
       [
        "@semantic-release/commit-analyzer",
        {
          "releaseRules": [
            {
              "type": "docs",
              "scope": "readme",
              "release": "patch"
            }
          ]
        }
      ],
      "@semantic-release/release-notes-generator",
      [
        "@semantic-release/changelog",
        {
          "changelogFile": "CHANGELOG.md",
          "changelogTitle": "# Change log for 'DLT-Logs':"
        }
      ],
      [
        "@semantic-release/npm",
        {
          "npmPublish": false
        }
            ],
            [
                "semantic-release-vsce",
                {
                    "packageVsix": "dlt-logs.vsix"
                }
            ],
      [
        "@semantic-release/github",
        {
          "assets": [
            {
              "path": "dlt-logs.vsix",
              "label": "DLT-Logs Visual Studio Code extension package"
            }
          ]
        }
      ],
      [
        "@semantic-release/git",
        {
          "message": "chore(release): ${nextRelease.version} [skip ci]"
        }
      ]
    ],
    "preset": "conventionalcommits"
  }
```

In addition to the conventional-commits rule a commit of type ```'docs'``` and scope ```'readme'``` triggers a patch release as well.
Besides that only the default rules apply:
- breaking -> major
- revert -> patch
- feat -> minor
- fix -> patch
- perf -> patch.

the last non automatic released version (v0.30.3) was tagged via
```sh
git tag v0.30.3 cac3d9b6b29a7d595f7388d4e14abee9c0caf7c4
git push origin v0.30.3
```

as semantic-release doesn't support major version being 0 and I didn't want to introduce an artifical breaking change I manually created a tag v1.0.0:

```sh
git tag v1.0.0 1ab80ce0dabe121ea1acb76b473509083e3d551a
git push origin v1.0.0
```

with this a manual release can be created via
```sh
VSCE_TOKEN=<your pat> GH_TOKEN=... npx semantic-release --no-ci
````

activated as github action (see file `.github/workflows/release.yml`)
```yml
name: Semantic Release and Publish
on:
  push:
    branches:
      - master
jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v2
        with:
          fetch-depth: 0
      - name: Commitlint
        uses: wagoid/commitlint-github-action@v2
      - name: Setup Node.js
        uses: actions/setup-node@v1
        with:
          node-version: 14
      - name: Install dependencies
        run: npm ci
      - name: Release
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          VSCE_PAT: ${{ secrets.VSCE_TOKEN }}
        run: npx semantic-release
```
This needs a ```VSCE_TOKEN``` secret defined in github/repo/settings/secrets.
