# Sponge for coding agents

Save articles and PDFs to a reading library captured by a computer you control. Highlight passages, keep notes, and find ideas through search or your coding agent.

This skill helps a coding agent find sources in your saved reading and answer
questions from them. It also covers saving and annotating reading when you ask.

## Connect your library

Install Sponge with Node.js `>=24.20.0`:

```sh
npm install --global @hraness/sponge@0.94.1
```

The task below uses a library that contains saved articles or PDFs. Follow the
[agent guide](https://sponge.computer/docs/agents) to create a library, save a first source, and
connect your agent. Its local MCP command is `sponge mcp`.

Ask the agent to find passages in your saved reading that answer a question,
read their context, and cite the sources in its answer. Search and reading work
without an account or model download. The guide covers optional capture and
sync setup, and links to platform requirements.

## License

The skill and integration files use the [MIT license](LICENSE). The Sponge
application is proprietary.
