# Releasing

A release is a tag. Push `vX.Y.Z` and `.github/workflows/release.yml` checks that the tag,
`package.json` and `server.json` name the same version, runs `npm run check`, publishes
`@appliedform/engine` to npm and publishes `server.json` to the MCP registry. Nothing is published
if any step before it fails.

Both publishes authenticate with the workflow's own OIDC token. There is no npm token or registry
token stored anywhere, and npm records provenance for each published version, linking it to the
commit and workflow run that built it.

## One-time setup

1. **The npm scope.** The package is `@appliedform/engine`, so the `appliedform` organisation must
   exist on npm and the person setting up must be able to publish to it.
2. **The first publish.** npm configures a trusted publisher from a package's settings page, so a
   package that has never been published has no page to configure. Publish the first version by
   hand, from a clean checkout of the commit that will carry its tag, with two-factor
   authentication, before the tag exists:

   ```sh
   git checkout <the export commit for 3.2.0>
   npm install && npx playwright install chromium && npm run check
   npm publish --access public
   ```

   Then push the tag as in "Cutting a version". Its Release run finds that version already on
   npm, skips the npm step, and publishes `server.json` to the MCP registry.

3. **The trusted publisher.** On npmjs.com, in the package's settings, add a trusted publisher:
   GitHub Actions, organisation `Applied-Form`, repository `engine`, workflow `release.yml`,
   environment `release`. npm expects a new trusted publisher to complete a publish within two
   days. Once one has, set the package to require trusted publishing and disallow tokens.
4. **The release environment.** In this repository's settings, the `release` environment can
   require a reviewer before a tag publishes, and can be limited to tags matching `v*`.
5. **The MCP registry.** Nothing to set up. `mcp-publisher login github-oidc` proves the workflow
   runs in the `Applied-Form` organisation, which owns the `io.github.Applied-Form` namespace that
   `server.json` names. The registry namespace follows the GitHub organisation's exact
   capitalisation, so a lowercase `io.github.applied-form` is refused. The registry checks that
   the npm package's `mcpName` matches the server name, so npm is published first.

## Cutting a version

This repository is exported from Applied Form's source repository. The version is set there, in
every place that carries it, and arrives here with the next export. Then:

```sh
git tag v3.2.0 && git push origin v3.2.0
```

Watch the Release run. If it fails before publishing, fix the cause, delete the tag, and tag the
fixed commit. A version that has been published to npm cannot be published again; the run skips
the npm step for it, so a failed MCP registry step can be retried by re-running the job.
