# Full slot demo plug-in (`beeftv-plugin-slot-test`)

`beeftv-plugin-slot-test` is a complete reference implementation and regression verification plug-in for the BeefTV plug-in system, covering:

- **All interface hanging points**: canvas node, add node menu, three canvas toolbars, right-click menu, node configuration panel, prompt word input box action, canvas sidebar, pre-generation hook, all 8 slots of the editing workbench, external material sources, material item actions, independent pages, global sidebar, global commands, custom settings panel, plug-in center column, project details paging, assistant tool result card.
- **All host events**: `generation.submitted`, `generation.completed`, `generation.failed`, `assets.imported`, `assistant.turnCompleted`.
- **Assistant Tools and Skills**: Provides `slot_test_ping` tools and `slot-test` skills.