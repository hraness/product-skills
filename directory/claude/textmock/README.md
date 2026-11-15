# Textmock conversation links

Make a fictional text conversation that opens as an editable copy in [Textmock](https://textmock.com). This package contains a coding-agent skill.

## Make your first link

Ask your agent for a short fictional conversation as a Textmock link. It writes the conversation as JSON and encodes it into a `https://textmock.com/s#` link. Open the link and choose **Make a Copy**. Edit the conversation, then choose **Save Image** or **Make Video**. Creating the link and viewing its preview change no saved conversation. Making a copy follows Textmock's usual conversation limit: free use keeps one conversation and adds a badge to exports; Pro allows more conversations and removes the badge.

Links make one-to-one conversations with replies off, up to 120 messages and 4,000 characters per message. Use the app's agent interface for groups, photos, attachments and rendering.

The link carries the conversation in the fragment after `#`, which browsers omit from navigation requests. Anyone with the complete link can read it. Keep full links out of logs when they contain private material.

Read [Use Textmock from an agent](https://textmock.com/docs/agents) for the browser API and Mac command, or the [conversation format](https://textmock.com/docs/conversation-format) for the app's full document shape. The MIT license covers this skill; the Textmock application has its own terms.
