# Hraness product skills

Skills for working with [Hraness](https://hraness.com) products from a coding agent. Each package explains its workflow, setup and first task.

## Product packages

- [DAWN](plugins/dawn/README.md): Music in code.
- [Sponge](plugins/sponge/README.md): Reading and notes.
- [Textmock](plugins/textmock/README.md): iMessage mockups.
- [Yaptake](plugins/yaptake/README.md): Video editor for Mac.

Read the product package for its app, command and access requirements.

```sh
npx skills add hraness/product-skills
```

Choose the product skill during installation, then follow its setup and first task. Use Sponge's [Raycast commands](adapters/raycast/README.md) to queue URLs and search saved text.

A package available here may still be awaiting directory review or host testing. See [package status](catalog/store-status.json), [skills.sh listing observations](docs/DIRECTORY_OBSERVATIONS.md) and [verified publications](publication-ledger.json).

## Product pages

- [DAWN](https://dawnav.com): Music in code.
- [Sponge](https://sponge.computer): Reading and notes.
- [Yaptake](https://yaptake.com): Video editor for Mac.
- [Textmock](https://textmock.com): iMessage mockups.

## Check a package

Use Node.js 24. Run `npm run check` to validate sources, generated copies and package metadata. `npm run package` writes deterministic plugin ZIPs and `SHA256SUMS` under `dist/`. The package license covers these skills and integration files; product applications have their own terms.

[Maintain packages](docs/MAINTAINING.md) · [Prepare a directory submission](docs/DIRECTORY_SUBMISSIONS.md) · [Submission index](docs/SUBMISSIONS.md) · [MIT license](LICENSE)
