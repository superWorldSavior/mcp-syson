# Diagram view fixtures

Snapshots (`syson_diagram_snapshot`, SVG removed) of the three SysON view
types recorded on 2026-10-24 from the local audit project `mcpview-ux-audit`,
package `UX views fixtures`:

- `interconnection.json`: `Drone` interconnection view (view frame, nested
  parts, ports, three connections and one item flow);
- `action-flow.json`: `Fly` action flow (actions, start, done, fork, join,
  decision, parameter ports, successions with guards, one item flow);
- `state-transition.json`: `FlightModes` state machine (nested `flying`
  state, entry actions, initial states, transitions with triggers and
  guards).

Hidden elements are already left out by the snapshot (see
`hiddenNodeCount` / `hiddenEdgeCount`).
