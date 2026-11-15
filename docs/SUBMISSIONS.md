# Submissions and listings

This index records proposed collection entries and links the existing publication and listing records. A submitted PR, a merged PR, a published package and a host directory approval describe different events. A merged PR does not prove that a listing remains available.

The [submission catalog](../catalog/submissions.json) owns saved searches, reviewed collection decisions and PR identities. The [15 November history audit](../catalog/submission-audit-2026-11-15.json) records the initial backfill. This page is generated; edit its source or the [publication ledger](../publication-ledger.json) and [directory observations](../catalog/directory-observations.json) through their documented checks.

## GitHub proposals

| Products | Collection or channel | Submitted | Provider state |
| --- | --- | --- | --- |
| Yaptake | [hraness/homebrew-tap #9](https://github.com/hraness/homebrew-tap/pull/9) | 2026-11-14 | Merged 2026-11-14 |
| Dawn, Sponge, Textmock, Yaptake | [BehiSecc/awesome-claude-skills #1345](https://github.com/BehiSecc/awesome-claude-skills/pull/1345) | 2026-11-15 | Submitted; open |

## Published packages and verified listings

These rows come from the existing records. The ledger keeps every earlier publication; a skills.sh first-verification date is not a publisher timestamp.

| Product | Channel | Record | Date |
| --- | --- | --- | --- |
| Dawn | GitHub package | [0.1.0](https://github.com/hraness/product-skills/releases/tag/integrations-8ba4ff744cbafb63) | Published 2026-11-14 |
| Sponge | GitHub package | [0.1.0](https://github.com/hraness/product-skills/releases/tag/integrations-8ba4ff744cbafb63) | Published 2026-11-14 |
| Textmock | GitHub package | [0.1.0](https://github.com/hraness/product-skills/releases/tag/integrations-8ba4ff744cbafb63) | Published 2026-11-14 |
| Yaptake | GitHub package | [0.1.0](https://github.com/hraness/product-skills/releases/tag/integrations-8ba4ff744cbafb63) | Published 2026-11-14 |
| Sponge | MCP Registry | [0.41.1](https://registry.modelcontextprotocol.io/v0.1/servers/io.github.hraness%2Fsponge/versions/0.41.1) | Published 2026-11-14 |
| Yaptake | Homebrew cask | [0.1.0](https://github.com/hraness/homebrew-tap/blob/c3415d95c69fb9db0f6a977eb62d0149cfda0898/Casks/yaptake.rb) | Published 2026-11-14 |
| Sponge | GitHub package | [0.1.1](https://github.com/hraness/product-skills/releases/tag/integrations-7d13bdbeafde2fd7) | Published 2026-11-14 |
| Dawn | GitHub package | [0.1.1](https://github.com/hraness/product-skills/releases/tag/integrations-9d0fff7312b9b8ff) | Published 2026-11-15 |
| Sponge | GitHub package | [0.1.2](https://github.com/hraness/product-skills/releases/tag/integrations-9d0fff7312b9b8ff) | Published 2026-11-15 |
| Textmock | GitHub package | [0.1.1](https://github.com/hraness/product-skills/releases/tag/integrations-9d0fff7312b9b8ff) | Published 2026-11-15 |
| Yaptake | GitHub package | [0.1.1](https://github.com/hraness/product-skills/releases/tag/integrations-9d0fff7312b9b8ff) | Published 2026-11-15 |
| Dawn | skills.sh | [Listed](https://www.skills.sh/hraness/product-skills/dawn) | First verified 2026-11-14 |
| Sponge | skills.sh | [Listed](https://www.skills.sh/hraness/product-skills/sponge) | First verified 2026-11-14 |
| Textmock | skills.sh | [Listed](https://www.skills.sh/hraness/product-skills/textmock) | First verified 2026-11-14 |
| Yaptake | skills.sh | [Listed](https://www.skills.sh/hraness/product-skills/yaptake) | First verified 2026-11-14 |

## Host directories

| Product | OpenAI | Claude | Cursor |
| --- | --- | --- | --- |
| Dawn | Review required | Review required | Review required |
| Sponge | Eligibility and review required | Review required | Review required |
| Textmock | Review required | Review required | Review required |
| Yaptake | Eligibility and review required | Review required | Review required |

No host directory submission URL has been verified for these packages. Sponge’s packaged Raycast Script Commands require manual import; they are not a Raycast Store listing. Follow [directory submission instructions](DIRECTORY_SUBMISSIONS.md) for account, demonstration and product requirements. Record a real provider acknowledgement before adding a submission claim.

## Repeat the collection searches

Use Node.js 24 and run `node scripts/submissions.mjs search PRODUCT` for one saved strategy. Each query requests the first 20 public results, sorted by stars. `{recent}` becomes the date 180 days before the run. The report identifies limited or incomplete results; it does not infer visitors or search traffic. Stars, forks and watchers describe public activity. Check subject fit and contribution rules before proposing an entry.

### Dawn

Music composition tools and agent skills with explicit private-preview prerequisites. Exclude paper lists and do not present the private runtime as publicly installable.

- `awesome music in:name stars:>=200 archived:false is:public fork:false pushed:>={recent}`
- `awesome live-coding in:name stars:>=100 archived:false is:public fork:false pushed:>={recent}`
- `awesome skills in:name stars:>=500 archived:false is:public fork:false pushed:>={recent}`

### Sponge

Local reading libraries, saving and annotating sources, CLI tools and installable MCP. Use the public homepage for proprietary runtime entries; do not label the runtime as open source.

- `awesome cli in:name stars:>=1000 archived:false is:public fork:false pushed:>={recent}`
- `"knowledge management" topic:awesome-list stars:>=100 archived:false is:public fork:false pushed:>={recent}`
- `awesome skills in:name stars:>=500 archived:false is:public fork:false pushed:>={recent}`

### Textmock

Fictional conversation mockups, design assets and agent link helpers. Check live maintainer acceptance, not only large historical star counts. Never describe the product as real message capture.

- `awesome design in:name stars:>=500 archived:false is:public fork:false pushed:>={recent}`
- `mockup topic:awesome-list stars:>=100 archived:false is:public fork:false pushed:>={recent}`
- `awesome skills in:name stars:>=500 archived:false is:public fork:false pushed:>={recent}`

### Yaptake

Released Mac video editors, transcript workflows and agent integrations. Distinguish editing existing footage from generative-video research.

- `awesome mac in:name stars:>=1000 archived:false is:public fork:false pushed:>={recent}`
- `awesome video in:name stars:>=200 archived:false is:public fork:false pushed:>={recent}`
- `awesome skills in:name stars:>=500 archived:false is:public fork:false pushed:>={recent}`

## Reviewed collections

Stars are dated public popularity counts, not traffic measurements. Review decisions come before those counts.

| Repository | Products | Stars at review | Decision | Review source |
| --- | --- | --- | --- | --- |
| [BehiSecc/awesome-claude-skills](https://github.com/BehiSecc/awesome-claude-skills) | Dawn, Sponge, Textmock, Yaptake | 10,424 | eligible: The existing shared PR proposes all four product skills and states runtime prerequisites. | [Rules; 2026-11-15](https://github.com/BehiSecc/awesome-claude-skills/blob/adf99015a0ad4dac11711c261f0f9b433e4215e7/README.md) |
| [jaywcjlove/awesome-mac](https://github.com/jaywcjlove/awesome-mac) | Yaptake | 118,567 | eligible: Native released video editor fits Audio and Video Tools; four language files are required and AI-assisted additions are welcome. No existing product entry or prior suggestion was found. | [Rules; 2026-11-15](https://github.com/jaywcjlove/awesome-mac/blob/7241efb1aa9841083728ca1a8da25ef011e83f13/docs/CONTRIBUTING.md) |
| [toolleeo/awesome-cli-apps-in-a-csv](https://github.com/toolleeo/awesome-cli-apps-in-a-csv) | Sponge | 2,681 | eligible: The contribution guide allows a public homepage without a clonable source repository. One CSV row fits Note taking; app source stays private. No prior product-name or domain suggestion was found. | [Rules; 2026-11-15](https://github.com/toolleeo/awesome-cli-apps-in-a-csv/blob/ecedca3e17ca879ddb204cd68752940e168f2616/CONTRIBUTING.md) |
| [agarrharr/awesome-cli-apps](https://github.com/agarrharr/awesome-cli-apps) | Sponge | 20,625 | ineligible: The repository is archived; new PRs cannot provide a maintained listing. | [Archived repository; 2026-11-15](https://github.com/agarrharr/awesome-cli-apps) |
| [appcypher/awesome-mcp-servers](https://github.com/appcypher/awesome-mcp-servers) | Sponge, Yaptake | 5,838 | ineligible: The repository is archived. | [Archived repository; 2026-11-15](https://github.com/appcypher/awesome-mcp-servers) |
| [hesreallyhim/awesome-claude-code](https://github.com/hesreallyhim/awesome-claude-code) | Dawn, Sponge, Textmock, Yaptake | 58,037 | ineligible: Resource recommendations must be made by a human through the web issue form. The guide explicitly prohibits CLI recommendations and PRs; it also requires 14 days of history or 100 stars. | [Rules; 2026-11-15](https://github.com/hesreallyhim/awesome-claude-code/blob/c7b893c49f775f1bd3d0f9e7b587c85580c99a42/CONTRIBUTING.md) |
| [travisvn/awesome-claude-skills](https://github.com/travisvn/awesome-claude-skills) | Dawn, Sponge, Textmock, Yaptake | 15,820 | ineligible: The guide explicitly excludes AI-assisted submissions and automatically closes skills below 10 stars; it also excludes commercial-funnel-only skills. | [Rules; 2026-11-15](https://github.com/travisvn/awesome-claude-skills/blob/1da55aa810f206d3fe2005e7e3989b15a275d942/CONTRIBUTING.md) |
| [VoltAgent/awesome-agent-skills](https://github.com/VoltAgent/awesome-agent-skills) | Dawn, Sponge, Textmock, Yaptake | 37,195 | deferred: The guide requires real community usage and rejects brand-new skills. Independent adoption of these newly published skills is not established. | [Rules; 2026-11-15](https://github.com/VoltAgent/awesome-agent-skills/blob/6d483e29da745a010d88974ef6d0e50d15755e9a/CONTRIBUTING.md) |
| [ComposioHQ/awesome-claude-skills](https://github.com/ComposioHQ/awesome-claude-skills) | Dawn, Sponge, Textmock, Yaptake | 79,533 | deferred: The guide requests copying a skill folder into its repository. An accepted external-link-only contribution path has not been verified; copying would create a separately maintained distribution source. | [Rules; 2026-11-15](https://github.com/ComposioHQ/awesome-claude-skills/blob/be2a406907dbc61b73e6827ded415c96139d13a2/CONTRIBUTING.md) |
| [sickn33/agentic-awesome-skills](https://github.com/sickn33/agentic-awesome-skills) | Dawn, Sponge, Textmock, Yaptake | 49,732 | deferred: This library imports skill source rather than curating only links. Scripts require a separate maintainer-sponsored review path, and no automatic update relationship to canonical product bundles is established. | [Rules; 2026-11-15](https://github.com/sickn33/agentic-awesome-skills/blob/560b762c309d6b96315855d7968727d3bca7df20/CONTRIBUTING.md) |
| [ad-si/awesome-music-production](https://github.com/ad-si/awesome-music-production) | Dawn | 1,560 | deferred: New entries need four months of history and either 100 stars or independent coverage. Those eligibility facts have not been established for the private-preview runtime. The rules also require author disclosure and an author-written usage description. | [Rules; 2026-11-15](https://github.com/ad-si/awesome-music-production/blob/24db42097fa28777db1ea3f82455e11e8d812689/contributing.md) |
| [noteflakes/awesome-music](https://github.com/noteflakes/awesome-music) | Dawn | 2,545 | deferred: The list requires generally used, stable projects. The public skill has a private-preview runtime prerequisite and no established general adoption. | [Rules; 2026-11-15](https://github.com/noteflakes/awesome-music/blob/b4ce518c33188e0f49dacca6b7262c2770deaf68/CONTRIBUTING.md) |
| [pjagielski/awesome-live-coding-music](https://github.com/pjagielski/awesome-live-coding-music) | Dawn | 651 | deferred: Its last push was 2022-09-20; a responsive current review path and publicly usable Dawn runtime are not established. | [Rules; 2026-11-15](https://github.com/pjagielski/awesome-live-coding-music/blob/bcaee484bf9e2e0fe66096dcfbac7cb8e57a201d/README.md) |
| [goabstract/Awesome-Design-Tools](https://github.com/goabstract/Awesome-Design-Tools) | Textmock | 41,900 | deferred: The repository has no recent accepted PR evidence: its latest merged-PR search ends at 2020-09-28. Recent suggestions are closed without merge; current curation availability is unverified. | [Rules; 2026-11-15](https://github.com/goabstract/Awesome-Design-Tools/blob/dc60e63c248c44acb42f09fb0c985b77b5fe4bf5/Contribution_Guidelines.md) |
| [gztchan/awesome-design](https://github.com/gztchan/awesome-design) | Textmock | 17,781 | deferred: The latest merged-PR search ends at 2021-06-15; there is no verified current acceptance path. | [Rules; 2026-11-15](https://github.com/gztchan/awesome-design/blob/89f81119a482c9c49c399c481a78ff6d82fd974c/README.md) |
| [brettkromkamp/awesome-knowledge-management](https://github.com/brettkromkamp/awesome-knowledge-management) | Sponge | 891 | deferred: The subject and existing commercial/local-library entries fit. Its rules require first-hand experience, which should be tied to a current disposable-library CLI task before proposing a listing. | [Rules; 2026-11-15](https://github.com/brettkromkamp/awesome-knowledge-management/blob/291fe063395e42d24e0a6c9c0fee1f0c551c9953/CONTRIBUTING.md) |

## Maintain the records

Run `node scripts/submissions.mjs refresh` to read only the saved public PRs and prepare a local status update. A failed read preserves all earlier states and first dates. The daily workflow proposes changes through the existing App-owned protected PR checks. It sends no comments, opens no external PRs and does not submit directory forms. An unchanged response creates no timestamp-only commit.

Before a new proposal, check existing rows and search the target’s issues and PRs for the product name and canonical URL. Save the exact target rules and review decision, use the maintained product skill or guide link, and record the returned PR URL once. Keep a shared PR as one record containing all affected products. Record a closed PR as closed unless the provider confirms a merge; do not infer rejection or acceptance from inactivity.

Drafted by Codex, an AI agent. Independent review is recorded in the delivery change.
