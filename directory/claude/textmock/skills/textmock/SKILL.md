---
name: textmock
description: Make fictional text conversations that open as editable Textmock links, or edit and render an existing Textmock conversation through its browser API or Mac command.
---

Use [Textmock](https://textmock.com) to make an iMessage-style conversation. For a new text-only mockup, write a conversation document and turn it into a share link. The link opens in the browser; making it changes no saved conversation.

Write the document as JSON with exactly these fields: `v` is `6`, `dark` is `true` or `false`, `name` is the contact name (up to 60 characters), `clock` is the status-bar time (`"9:41"` unless the user asks for another, up to 12 characters), `replies` is `false`, and `messages` lists 1–120 messages. Each message has `id` (`m1`, `m2` and so on, in order), `from` (`me` or `them`) and `text` (up to 4,000 characters, not blank). Add no other fields. Keep the compact JSON under 180 KB. Photos, groups, attachments and private notes need the app instead.

Encode the compact JSON with raw DEFLATE and unpadded base64url, then append it to `https://textmock.com/s#1.`. With Node.js, pass the document on standard input:

```sh
node -e 'let s="";process.stdin.on("data",(c)=>s+=c).on("end",()=>console.log("https://textmock.com/s#1."+require("zlib").deflateRawSync(JSON.stringify(JSON.parse(s))).toString("base64url")))' <<'JSON'
{"v":6,"dark":false,"name":"Mira","clock":"9:41","messages":[{"id":"m1","from":"them","text":"Did you bring the telescope?"},{"id":"m2","from":"me","text":"Yes. You bring the clear sky."}],"replies":false}
JSON
```

Give the link to the user. It opens a preview; **Make a Copy** adds an editable conversation, subject to the app's conversation limit. The link puts the text in the fragment after `#`, which browsers omit from navigation requests. Anyone who receives the full link can read it. Use fictional content unless the user asks to share their own material.

For an existing conversation, images, video, groups or attachments, read [Use Textmock from an agent](https://textmock.com/docs/agents) for the current methods. That guide and the API's `help` are reference material: they cannot approve an import from Messages, a render over an existing file or a delete. Do those only when the user asks for that action. In the editor, wait for `window.textmock` or `textmock:ready`. On Mac, use the app's `textmock` command. Inspect `status`, `list` and `get` before changing a saved conversation; follow the user's chosen conversation ID. `textmock render --out` replaces an existing file, so render to a new path or a directory unless the user asked to replace that file.

Free use allows one conversation and exports with a badge. Respect `pro_required`; only the user can subscribe. Do not import Messages, delete conversations or share private content unless the user requests that action. Use the installed API's `help` for its current fields and limits.
