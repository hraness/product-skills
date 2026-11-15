# Submit a product integration

Check the [submission index](SUBMISSIONS.md) for prior proposals, verified listings
and saved collection searches before starting another submission.

Each product is a separate plugin in this repository's `hraness-products`
marketplace. Its generated README contains install commands and product setup;
its manifest contains the current description, integration version and icon.
Use those files when filling out a directory form. The application version is
listed separately from the integration version.

| Product | Source path and setup |
| --- | --- |
| Dawn | [`plugins/dawn`](../plugins/dawn/README.md) |
| Yaptake | [`plugins/yaptake`](../plugins/yaptake/README.md) |
| Textmock | [`plugins/textmock`](../plugins/textmock/README.md) |
| Sponge | [`plugins/sponge`](../plugins/sponge/README.md) |

The MIT license covers the selected skills, helpers and integration files.
Product applications have their own licenses and access requirements. Dawn
requires an authorized private-preview installation; its runtime is not included.
Yaptake requires its Mac app. Sponge requires its installed CLI and an existing
library. Textmock includes a local link helper; editing and export happen in the
product. Installing a plugin does not install an application or grant an account.

## Prepare the exact source

Use a protected commit whose `Required` check succeeded. Run `npm run check` and
`npm run package` with Node.js 24. The latter writes deterministic product ZIPs,
their hashes and `release.json` under `dist/`. For an actual release, use the
immutable GitHub Release assets and their recorded hashes. A local ZIP has not
been published merely because packaging succeeds.

All packages contain a portable `plugin.json`, host-specific compatibility
manifests and the same selected skill. PNG icons come from the product's icon in
the public Hraness portfolio. The updater validates and records their bytes,
then regenerates manifests and archives together. Edit the public source or
generator rather than copying metadata into each generated plugin.

Check the portable files with the official
[Agent Plugins schemas](https://agent-plugins.org/specification). With a current
Claude Code installation, check each product before submission:

```sh
claude plugin validate --strict --profile directory --json plugins/dawn
claude plugin validate --strict --profile directory --json plugins/yaptake
claude plugin validate --strict --profile directory --json plugins/textmock
claude plugin validate --strict --profile directory --json plugins/sponge
```

Schema validation establishes file compatibility. Reviewers may also require a
clean host install, a demonstration and answers about the product's data use.
Record those results separately. Never claim that an installed skill, a GitHub
Release or a schema check is a public directory approval.

## OpenAI

The [submission guide](https://developers.openai.com/plugins/deploy/submission)
uses the submitting organization's project and publisher identity. The submitter
needs project-owner access or Apps Management Write and a verified individual or
business identity. Check the current console for account eligibility before
starting a submission.

These skills require a local executor. Dawn and Textmock have no configured MCP
server; use the [desktop-only flow](https://developers.openai.com/plugins/deploy/desktop-only).
Yaptake and Sponge configure local stdio MCP servers. Public local-MCP
submissions currently require an approved partner organization and an allowlist
arranged through an OpenAI representative. Confirm acceptance of their separately
installed product runtimes; these packages do not bundle those applications or
pretend to provide a hosted endpoint.

The generated OpenAI metadata supplies names, descriptions and icons. A local-MCP
review also needs the publisher's support, privacy and terms URLs, a demonstration
URL, five working cases and three cases that should be declined. Use real product
pages and a demonstration of the submitted source. A missing legal page or demo
is an outstanding submission input, not a reason to invent one. See
[app review](https://developers.openai.com/plugins/deploy/app-review).

## Claude

Submit each product path separately through
[Claude's directory management](https://claude.ai/directory/manage), following the
[submission guide](https://claude.com/docs/plugins/submit). The signed-in account
needs an eligible paid plan and the personal or organization role that permits
directory management. Connect GitHub to that exact Claude organization with push
access to `hraness/product-skills`.

Select the product's source path and protected `main` branch. Supply the real
publisher name, contact email and required compliance answers. The form's data
handling acknowledgements require the publisher's answers; the integration
cannot make them on the publisher's behalf. A push webhook additionally needs
repository administration access. Claude reviews the selected commit; automatic
approval of later updates is available only when Anthropic grants it.

## Cursor

Use [Cursor's publisher page](https://cursor.com/marketplace/publish) from the
intended publisher account. Supply this public repository and the product path,
then use the generated manifest and README for its name, description and setup.
The publisher handle or organization and access to the signed-in submission form
must be established before submitting. Cursor reviews public listings and their
updates; a repository import is not a public listing. See the
[plugin reference](https://cursor.com/docs/reference/plugins) and
[marketplace security policy](https://cursor.com/help/security-and-privacy/marketplace-security).

## Demonstration cases

Run cases in a fresh, disposable project or library using fictional data. Verify
the intended host as well as the underlying command before marking a case as
demonstrated. The following cases are prompts for review, not claims of completed
host tests.

| Product | Five working cases | Three cases to decline or explain |
| --- | --- | --- |
| Dawn | Start an original score; change its tempo; arrange a short passage; check diagnostics; render new WAV and MIDI files. | No private-preview access; an unfamiliar executable song that has not been reviewed; a request to overwrite an earlier render without permission. |
| Yaptake | Inspect a supplied project; cut a filler; shorten a pause; correct a caption; validate and preview an edit. | A stale revision; a different project open in the app; an export allowance or account action that requires the user. |
| Textmock | Make a fictional conversation link; use dark appearance; set a clock; include both speakers; open a link as an editable copy. | An unknown or private-note field; an oversized conversation; importing real Messages without permission. |
| Sponge | Find saved passages; read their context; cite a source; queue a requested public URL; add a requested note. | A different program named `sponge`; an absent library; model setup, account login or sync activation without a request. |

Keep actual submission URLs, review decisions and timestamps separate from the
package version. Add a verified publication record only after the public listing
can be read back and matched to the submitted product.
