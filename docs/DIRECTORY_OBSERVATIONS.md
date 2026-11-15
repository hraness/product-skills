# skills.sh directory records

The [directory observations](../catalog/directory-observations.json) record when
Dawn, Sponge, Textmock and Yaptake were first verified on skills.sh. They describe
listing presence. They do not record a publisher's release time or approval by
an agent host.

`firstVerifiedAt` is the time of our first complete, successful check of the four
listings. The initial date comes from the
[November 14, 2026 verification](../catalog/directory-verification-2026-11-14.json),
after one temporary-project installation with the official skills CLI. That
installation preserved the selected helper and example files. Its timestamp
and the later directory check have separate fields in the verification record.

skills.sh exposes no publication timestamp in its documented detail API or in
the structured metadata observed on these pages. HTTP `Date` describes a
response, and is not a publication date. Existing publisher dates in
`publication-ledger.json` keep their meaning.

## Check the listings

Run with Node.js 24 from this checkout:

```sh
node scripts/skills-sh-observer.mjs check
node scripts/skills-sh-observer.mjs observe
```

`check` validates the saved records. `observe` reads the four canonical public
URLs and prints proposed records and a check report. It does not write files,
install skills or send install telemetry.

The reader checks standard `application/ld+json` metadata and the canonical
link. Each page must identify one schema.org `SoftwareApplication` with the
expected skill name, URL, current frontmatter description and Hraness publisher
identity. It ignores layout, counters, badges and React data. An HTTP 200 error
page containing only generic `WebSite` metadata cannot establish a listing.

All four responses must verify before the reader returns an update. Requests
carry no credentials, follow no redirects and have time and size limits. A
failed or changed response leaves the saved records available for the caller
to preserve. A successful unchanged check produces identical records, so a
daily check needs no timestamp commit.

The JSON-LD is public structured page metadata, rather than a versioned provider
API. A metadata change that the reader cannot verify requires a reviewed reader
update. The [documented API](https://www.skills.sh/docs/api) provides a stable
skill identifier and optional file snapshots, but requires Vercel OIDC. This
observer needs no new credentials and does not call an undocumented API.

## Interpret the source hash

`sourceSkillHash` identifies the local public skill folder at the successful
check. It is the SHA-256 of the UTF-8 JSON encoding of a sorted array of
`{path, bytes, sha256}` entries. Paths are relative to `skills/<product>/` and
file hashes cover their original bytes. The helper and example participate in
the hash. Icons, integration ZIP versions, MCP launchers and Raycast adapters
outside the skill folder do not.

This hash does not prove the bytes in a directory cache. The observer checks
listing presence; `remoteFileBytesVerified` is false in its check report. The
initial installation has separate file-by-file proof against its public source
commit. A local helper change can update `sourceSkillHash` after another
successful presence check without inventing a new directory publication date.

## Consume the records

`observeDirectories(previous, sources, options)` returns a proposed record and
a transient report after all four reads finish. `readDirectorySources(root)`
builds the expected identities from regular UTF-8 checkout files. The selected
frontmatter uses one-line scalar `name` and `description` fields; unsupported
YAML forms fail the check.

An automatic refresh caller should preserve its source and branch checks, call
the reader before writing, and use `mergePendingDirectoryObservations` when
updating an existing generated proposal. That merge preserves committed first
verification dates and the earlier of concurrent, uncommitted observations.
The observer does not read or modify the admitted product catalog, so optional
fields such as product icons remain with their existing owner.

Use wording such as “skills.sh listing first verified” for search-measurement
annotations. Keep this event distinct from a GitHub release or a publisher's
recorded publication date. A “listed” status describes directory availability;
it grants no ChatGPT, Claude, Cursor or Raycast store approval.
