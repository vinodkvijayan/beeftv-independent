# Canvas sticky note plug-in (`beeftv-plugin-sticky-note`)

`beeftv-plugin-sticky-note` is an entry-level template plug-in developed by BeefTV plug-in, which fully demonstrates the four elements of a standard plug-in package:

1. `package.json`: Declare the `beeftv` manifest with the `pi` extension/skill path.
2. `extensions/index.ts`: Register `sticky_note_create` and `sticky_note_update` assistant tools, and call Go business operations through `ctx.executeTool`.
3. `skills/sticky-note/SKILL.md`: Instruct the creative assistant on how to break down key points and create sticky notes.
4. `client/index.js`: Register color-changeable and editable canvas note nodes and "Add Node" menu items through `activate(host)` and `host.contribute`.