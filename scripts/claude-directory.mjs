// Claude directory copies of the product plugins.
//
// The Claude directory accepts only Markdown, text, JSON, YAML and listing
// images from organizations it has not verified, and no MCP server that runs on
// the user's computer. These copies keep each product's skill and drop the local
// MCP configuration, launchers and adapters. The full packages under plugins/
// stay unchanged for Codex, Cursor and repository installs.

export const CLAUDE_DIRECTORY_ROOT = 'directory/claude';
export const CLAUDE_DIRECTORY_PRODUCTS = Object.freeze(['dawn', 'oh', 'sponge', 'textmock', 'yaptake']);
const ALLOWED = /\.(?:md|txt|json|ya?ml|png)$|(?:^|\/)LICENSE$/;

/** Every file a product's directory copy may contain, relative to its folder. */
export function claudeDirectoryMembers(id) {
  if (!CLAUDE_DIRECTORY_PRODUCTS.includes(id)) throw new Error('Unknown Claude directory product');
  return ['.claude-plugin/plugin.json', 'LICENSE', 'README.md', 'assets/icon.png', `skills/${id}/SKILL.md`, ...(id === 'dawn' ? ['skills/dawn/examples/morning-study.md'] : [])];
}

/** Whether an automated product update may write this repository path. */
export function claudeDirectoryPath(path) {
  const match = /^directory\/claude\/([a-z]+)\/(.+)$/.exec(path);
  return Boolean(match) && CLAUDE_DIRECTORY_PRODUCTS.includes(match[1]) && claudeDirectoryMembers(match[1]).includes(match[2]);
}

/** Files for one product's directory copy, keyed relative to its folder. */
export function claudeDirectoryFiles(id, files, { manifest, icon = null }) {
  if (!CLAUDE_DIRECTORY_PRODUCTS.includes(id)) return null;
  const skill = `skills/${id}/SKILL.md`;
  const out = { '.claude-plugin/plugin.json': manifest, LICENSE: files.LICENSE, 'README.md': files['README.md'], [skill]: files[skill] };
  if (icon) out['assets/icon.png'] = icon;
  if (id === 'dawn') {
    const example = files['skills/dawn/examples/morning-study.ts'];
    out['skills/dawn/examples/morning-study.md'] = `# Morning study\n\nAn original eight-bar Dawn score with synthesized instruments. Copy the code into \`song.ts\` in a new Dawn project.\n\n\`\`\`ts\n${example.trimEnd()}\n\`\`\`\n`;
    // Every reference to the example follows it to its Markdown copy.
    out[skill] = out[skill].replaceAll('examples/morning-study.ts', 'examples/morning-study.md').replace('Copy it to `song.ts`', 'Copy its code to `song.ts`');
    out['README.md'] = out['README.md'].replaceAll('examples/morning-study.ts', 'examples/morning-study.md');
  }
  if (id === 'textmock') {
    // The bundled link helper is a script, so the copy explains the link format and lets the agent encode it.
    out[skill] = textmockSkill(files[skill]);
    out['README.md'] = TEXTMOCK_README;
  }
  for (const path of Object.keys(out)) if (!ALLOWED.test(path) || !claudeDirectoryMembers(id).includes(path)) throw new Error(`Claude directory copy refuses ${path}`);
  return out;
}

// Reads a Textmock document on stdin and prints its share link, like the bundled helper's encodeLink.
export const TEXTMOCK_LINK_COMMAND = `node -e 'let s="";process.stdin.on("data",(c)=>s+=c).on("end",()=>console.log("https://textmock.com/s#1."+require("zlib").deflateRawSync(JSON.stringify(JSON.parse(s))).toString("base64url")))'`;
const TEXTMOCK_EXAMPLE = '{"v":6,"dark":false,"name":"Mira","clock":"9:41","messages":[{"id":"m1","from":"them","text":"Did you bring the telescope?"},{"id":"m2","from":"me","text":"Yes. You bring the clear sky."}],"replies":false}';

const TEXTMOCK_LINK = `Use [Textmock](https://textmock.com) to make an iMessage-style conversation. For a new text-only mockup, write a conversation document and turn it into a share link. The link opens in the browser; making it changes no saved conversation.

Write the document as JSON with exactly these fields: \`v\` is \`6\`, \`dark\` is \`true\` or \`false\`, \`name\` is the contact name (up to 60 characters), \`clock\` is the status-bar time (\`"9:41"\` unless the user asks for another, up to 12 characters), \`replies\` is \`false\`, and \`messages\` lists 1–120 messages. Each message has \`id\` (\`m1\`, \`m2\` and so on, in order), \`from\` (\`me\` or \`them\`) and \`text\` (up to 4,000 characters, not blank). Add no other fields. Keep the compact JSON under 180 KB. Photos, groups, attachments and private notes need the app instead.

Encode the compact JSON with raw DEFLATE and unpadded base64url, then append it to \`https://textmock.com/s#1.\`. With Node.js, pass the document on standard input:

\`\`\`sh
${TEXTMOCK_LINK_COMMAND} <<'JSON'
${TEXTMOCK_EXAMPLE}
JSON
\`\`\`

Give the link to the user. It opens a preview; **Make a Copy** adds an editable conversation, subject to the app's conversation limit. The link puts the text in the fragment after \`#\`, which browsers omit from navigation requests. Anyone who receives the full link can read it. Use fictional content unless the user asks to share their own material.`;

/** The Textmock skill with its helper steps replaced by the link format. */
export function textmockSkill(source) {
  const front = /^---\n[\s\S]*?\n---\n/.exec(source)?.[0];
  if (!front) throw new Error('Textmock skill has no frontmatter');
  // Keep the source's guidance for saved conversations; without it, point to the agent guide.
  const at = source.indexOf('\n\nFor an existing conversation');
  const rest = at === -1 ? 'For an existing conversation, images, video, groups or attachments, read [Use Textmock from an agent](https://textmock.com/docs/agents).\n' : source.slice(at + 2);
  return `${front}\n${TEXTMOCK_LINK}\n\n${rest}`;
}

const TEXTMOCK_README = `# Textmock conversation links

Make a fictional text conversation that opens as an editable copy in [Textmock](https://textmock.com). This package contains a coding-agent skill.

## Make your first link

Ask your agent for a short fictional conversation as a Textmock link. It writes the conversation as JSON and encodes it into a \`https://textmock.com/s#\` link. Open the link and choose **Make a Copy**. Edit the conversation, then choose **Save Image** or **Make Video**. Creating the link and viewing its preview change no saved conversation. Making a copy follows Textmock's usual conversation limit: free use keeps one conversation and adds a badge to exports; Pro allows more conversations and removes the badge.

Links make one-to-one conversations with replies off, up to 120 messages and 4,000 characters per message. Use the app's agent interface for groups, photos, attachments and rendering.

The link carries the conversation in the fragment after \`#\`, which browsers omit from navigation requests. Anyone with the complete link can read it. Keep full links out of logs when they contain private material.

Read [Use Textmock from an agent](https://textmock.com/docs/agents) for the browser API and Mac command, or the [conversation format](https://textmock.com/docs/conversation-format) for the app's full document shape. The MIT license covers this skill; the Textmock application has its own terms.
`;
