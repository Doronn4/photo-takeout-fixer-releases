# photo-takeout-fixer-releases
Official Photo Takeout Fixer installer downloads. Application source is maintained separately.

[Download the latest release](https://github.com/Doronn4/photo-takeout-fixer-releases/releases/latest)

Only the latest stable desktop release is publicly available. Superseded releases and prereleases are retained as unpublished drafts for repository writers; their installer links are unavailable to the public.

## Release maintenance

The `Keep only the latest public release` workflow runs on release publication or edits, policy pushes, manual dispatch, and hourly reconciliation. It resolves GitHub's current latest stable release, requires its installer and metadata assets, and converts every other published release to a draft. It never deletes or replaces assets. Public prereleases are not a supported distribution channel; keep candidates as drafts.

Publication and cleanup are separate GitHub operations, so older downloads can remain available briefly while the workflow runs. Existing downloaded copies, third-party mirrors, and already-issued expiring CDN download URLs cannot be recalled.

Check the workflow result after every publication. API errors, incomplete latest releases, concurrent changes of latest, and immutable obsolete releases cause an explicit failure. Keep release immutability disabled because immutable releases cannot be reverted to drafts. Use private storage for long-term immutable archives.

To inspect or apply the policy locally with an authenticated GitHub CLI:

```sh
node --test .github/scripts/latest-only.test.mjs
node .github/scripts/latest-only.mjs
node .github/scripts/latest-only.mjs --apply
```

The public repository contains release-maintenance infrastructure only. Do not commit desktop installers, application source, customer files, or private build artifacts to Git history or public Actions artifacts.
