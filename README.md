# Hraness product skills

Skills for working with [Hraness](https://hraness.com) products from a coding agent. Each package explains its workflow, setup and first task.

## Product packages

- [Sponge](plugins/sponge/README.md): Reading and notes.

Read the product package for its app, command and access requirements.

```sh
npx skills add hraness/product-skills
```

Choose the product skill during installation, then follow its setup and first task. A package available here may still be awaiting directory review or host testing. See [package status](catalog/store-status.json) and [verified publications](publication-ledger.json).

## Product pages

- [Dawn](https://dawnav.com): Music in code.
- [Yaptake](https://yaptake.com): Video editor for Mac.
- [Textmock](https://textmock.com): iMessage mockups.
- [Sponge](https://sponge.computer): Reading and notes.

## Check a package

Use Node.js 24. Run `npm run check` to validate sources, generated copies and package metadata. `npm run package` writes deterministic plugin ZIPs and `SHA256SUMS` under `dist/`. The package license covers these skills and integration files; product applications have their own terms.

[Maintain packages](docs/MAINTAINING.md) · [MIT license](LICENSE)
