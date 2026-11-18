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

Until Anthropic verifies the publishing organization, the directory refuses
plugins that run a local MCP server or ship scripts and other files that aren't
Markdown, text, JSON, YAML or images. Submit the generated copy under
`directory/claude/<product>` instead of `plugins/<product>`. It keeps the
product's skill, its listing links and icon, and drops the local MCP
configuration, launchers and adapters; Dawn's example becomes Markdown.
Textmock's copy drops the link helper and describes the share-link format, which
the agent encodes with a one-line command. A submission's
path can't change later, so withdraw a refused `plugins/<product>` submission and
submit the copy's path.

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

## Submitted forms

Web form acknowledgements are kept in dated records, starting with
[15 November](../catalog/form-submissions-2026-11-15.json). A form
acknowledgement or a submission page in review isn't a listing. On 15 November,
Claude reviewers held the Dawn, Sponge and Yaptake directory copies. The
directory refused Textmock's helper, so its directory copy replaced that
submission. Cursor received one publisher
application for all four plugins. mcpservers.org listed Sponge in its Memory category, and
awesome.video received Yaptake. Later that day, mcpmarket received each
product's skill and claudemarketplaces received the marketplace, both in free
queues. cursor.directory published the marketplace pending its security scan.
SaaSHub received Sponge, listed as Sponge.computer because the name Sponge was
taken, and Yaptake. It accepts no further submission from the account until it
approves one. Uneed scheduled Sponge's free launch for 21 June 2027. MacUpdate received the Yaptake and Textmock Mac apps.

On [16 November](../catalog/form-submissions-2026-11-16.json), AlternativeTo
received Yaptake, Textmock and Sponge in its free review queue. Sponge is listed
as Hraness Sponge because the name Sponge was taken. The Awesome Copilot
marketplace received Sponge, Yaptake and Textmock as external plugin issues,
and all three passed its automated checks. The mcp.so web form now offers only
a paid listing, so Sponge and Yaptake went to its free GitHub issue queue.

On [17 November](../catalog/form-submissions-2026-11-17.json), MacBase received
Yaptake and Sponge, and LocalAlternative, Future Tools and MacUpdate received
Sponge, all in review. MacPip listed Sponge and received Yaptake from the owner.
DevHunt queued both for its free launch on 11 November 2031. EdTech Impact saved
an unpublished Textmock profile pending review. On Peerlist the owner verified
their profile, Yaptake's Launchpad launch was booked for week 48, and Sponge and
Textmock projects were saved. The owner chose week 49 for Sponge and Textmock is
planned for week 50, but Peerlist books only the coming week, so those wait for
23 and 30 November. PeerPush queued Sponge, Textmock and Yaptake for free
launches on the owner's account, about four months out. Glama was asked by email
to index Sponge's MCP Registry entry. Kext received an Indie Spotlight
application for Sponge. The owner chose to skip Alternative.me.

On 18 November, a [check of every GitHub submission](../catalog/submission-audit-2026-11-18.json)
recorded these outcomes. Awesome Copilot's maintainer rejected Textmock and
Yaptake, saying each mainly promotes its app; Sponge still waits for review. FMHY moved its Textmock suggestion to its Discord for testing,
so Textmock isn't listed there. mcp.so hasn't replied to either issue. The
awesome-harness-engineering maintainer closed the Sponge PR because the list
links only open-source projects. The Sponge Raycast Store extension proposed on
16 November waits for Raycast's review, and Textmock's buildwithclaude entry was
resubmitted with the safety line its reviewer asked for.

Later on [18 November](../catalog/form-submissions-2026-11-18.json),
NoSignupTools received six free tools for review: Sponge's YouTube transcript
and PDF to Markdown tools, Yaptake's LUFS meter, silence remover and safe zones,
and Textmock's fake text generator. Terminal Trove received the Sponge CLI, and
its curators try each tool before listing it. Sponge's thread reader was
proposed to awesome-twitter-tools and awesome-hacker-news. Launching Next forms
for Sponge, Yaptake and Textmock were filled in, and each waits for the owner to
answer its human check. Homebrew's main cask collection is deferred until the
apps show independent public interest, and its formula collection accepts only
open-source software, so the Sponge CLI isn't eligible there. Smithery was
skipped because publishing there needs the owner's sign-in.

After that, directory.llmstxt.cloud put sponge.computer, textmock.com and
yaptake.com on its free waiting list, which publishes accepted sites in batches
over one to three months, and llmstxt.site received the same three sites. Three
more lists received pull requests. awesome-no-login-web-apps got Yaptake's
silence remover and LUFS meter and Sponge's PDF to Markdown converter,
Awesome-llms-txt got the llms.txt files of all three sites, and ALL about RSS
got Sponge, which follows a site's feed. HeyClaude lists commercial tools only
as editorial picks or paid sponsorships, so nothing was sent there.

After the owner signed in, the llms.txt hub's form opened a pull request for
each of the three sites, and the hub's review bot holds them for its
maintainer. The owner approved a Black Friday discount: half off the first 12
months of Sponge Plus and Yaptake for new subscribers, with codes that expire at
the end of 2 December 2026, Pacific time. Sponge's pricing page shows its code,
and its entry in Awesome Black Friday Cyber Monday merged the same day. The
change that adds Yaptake's code to its pricing section merged and reaches the
site with its next deploy. FluidAudio's showcase received Yaptake, which
transcribes through FluidAudio. Show and tell posts introduced the three
product skills in the Anthropic skills Discussions and the Yaptake plugin in the
Codex Discussions.

Textmock joined the Black Friday offer with half off the first 12 months of
Textmock Pro, ending with the other codes. Seven more Black Friday lists
received pull requests. Black-Friday-Deals, Awesome Black Friday Cyber Monday
deals, the Mac apps list and the lists from Pimjo and dqhieu got all three
products. Rare Big Deal and the BoltAI list got Sponge and Textmock, and the
BoltAI list's review bot passed both. saasblackfriday.online received all three
through its free review form. The lists that check an offer on the product's own
page get Yaptake once yaptake.com shows its code after the next deploy, and
zPlatform's tracker for AI tools waits for the same reason. IndieMarkdowns takes
deals only as an email from the maker, so nothing was sent there.

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
