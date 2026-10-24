# Browse model elements and diagram views

Use this workflow in a client that supports MCP Apps. You need an existing SysON
project, its actual `editingContextId`, and an element or diagram identifier.
[Getting started](../getting-started.md) covers connecting the provider.

## Open a model branch

1. Call `syson_project_get` with the project ID and keep its `editingContextId`.
   Project and editing-context identifiers are distinct.
2. Call `syson_element_children` with that editing context and a known parent
   element ID. The model explorer shows the direct children returned by SysON.
3. Filter by label or kind to find an element. Double-click its row, press Enter
   on the focused row, or use its Children action to read that element's direct
   children. Opening a branch can return an empty list; the viewer does not
   assume that every listed element has children.
4. Use the path above the list to return to an earlier level. The kit `PathBar`
   retains the visited parent levels, including their filter and scroll
   position. Long paths collapse earlier levels into a disclosure.

Local navigation keeps the viewer's AI context basket. Returning to a parent or
changing the interface language does not clear those selections. A change to the
actual viewer root starts a new selection scope.

If live navigation is unavailable, the viewer says so. It needs the host's
`serverTools` capability and a supplied editing-context identifier. Recorded
sessions show their captured content without requesting additional branches from
SysON.

## Inspect a diagram and choose a view

1. Call `syson_diagram_list` with the editing context, then call
   `syson_diagram_snapshot` with the ID of an existing diagram.
2. Use the diagram's zoom and fit controls to inspect its contents. Choose
   **Select** to select elements; choose **Pan** to move the canvas. You can
   also hold Space and drag to pan temporarily, then release Space to return to
   the chosen mode.
3. In Select mode, drag on the background to add fully enclosed primary blocks
   (parts in an architecture view). Internal rows, ports and relationships are
   excluded from rectangle selection. Individual clicks can still select those
   precise elements. The rectangle adds to the existing basket.
4. Double-click an element or press Enter on its focused row to inspect its
   identity and, when live reads are available, its element details. Use the
   detail path to return to the diagram. Inspecting preserves the selection that
   preceded the gesture.
5. Choose **Browse existing views** to list the project's existing
   representations. Selecting an existing diagram reads its snapshot in the same
   viewer. A representation that needs a table or dedicated viewer shows an
   explicit explanation instead of being treated as a diagram.

The available native types shown below the chooser come from
`syson_diagram_types` for the diagram's target element. They describe views that
SysON can offer in that context. They are separate from existing
representations; listing a type does not create a view. The chooser does not
create one either.

The local SVG renderer preserves supplied topology and coordinates where
available, with approximate styling and layout. It is not a pixel-identical copy
of the SysON editor. The current snapshot query bounds child-node recursion to
depth 8; do not treat it as an unbounded model export.

## Prepare context for the next AI turn

Click a selectable element to toggle it in the AI context basket. Space also
toggles focused rows in the model explorer; in diagrams, Space is reserved for
temporary panning. Click again to remove it. Use the basket to remove an item
from another visited level, clear the context, or retry a failed update. The
same gestures apply to the model explorer and diagram viewer. Authored
requirement rows also support click and Space selection; they do not offer a
live requirement-detail drill.

The basket shows selections accepted by the host. While an update is pending or
has failed, the viewer displays that state. Host acceptance means the context
has been prepared for future turns; it does not prove that a model has consumed
it or trigger an AI response. If the host lacks context-update support, the
basket displays that limitation.

Recorded sessions can still prepare selected captured identities and summaries
for a capable host. They never use selection or inspection to make provider
calls. In a recorded diagram, inspection is limited to the captured identity.

## Read requirement evidence at the right level

Use the authored-requirements viewer for the captured requirement names,
metrics, operators, values and units. Use the separate requirements-trace viewer
for satisfaction-link coverage. A requirement statement, an authored limit or a
satisfaction link does not establish a measured result or a validation verdict.
Check the validation viewer and its underlying operation when you need
validation evidence.

For resource identifiers, payload contracts and capability boundaries, see
[MCP Apps and recorded viewer contracts](../mcp-apps.md).
