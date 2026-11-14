# {{PRODUCT}} in Raycast

Queue a URL in {{PRODUCT}} or search saved text from Raycast. These Script Commands use the {{PRODUCT}} CLI installed on your Mac.

Use {{PRODUCT}} {{VERSION}} or later and Node.js {{NODE}} or later. Follow the [Sponge setup]({{SETUP_LINK}}) and initialize your library before adding the commands.

1. Extract the Sponge release ZIP, or keep this repository checkout. Keep this folder and its files together.
2. In Raycast Settings, open **Extensions**, choose **+**, then **Add Script Directory**.
3. Select the `adapters/raycast` folder.
4. Run **Save URL to Sponge** with `https://example.com/`. The command reports that the URL was queued. Processing follows your Sponge capture setup.
5. Run **Search Sponge** with a phrase from your saved reading. It displays up to 20 lexical search results.

The commands use Sponge's default library. For a different existing library, set `SPONGE_RAYCAST_LIBRARY` to its absolute directory in the environment Raycast receives. If your CLI is outside its usual command path, set `SPONGE_RAYCAST_CLI` to the absolute `sponge` executable. The commands verify the installed `@hraness/sponge` package and its version before using it.

Saving adds the URL to Sponge's capture queue. A worker you have already configured can process it. Searches use lexical full-text matching and need no embedding model.

These scripts are available for manual import. Source tests and an isolated CLI check cover their command behavior. They have not been tested in the Raycast UI.

[Raycast Script Commands](https://github.com/raycast/script-commands) · [MIT license](../../LICENSE)
