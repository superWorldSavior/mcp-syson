# Live audit fixtures

Captured on 2026-10-24 through the audit host MCP route at
`http://127.0.0.1:3319/mcp`, using SysON at `http://127.0.0.1:8180`. These are
unmodified tool result envelopes from project `mcpview-ux-audit`.

- Project: `d78c1a03-a504-4129-97f8-3b850f1be4d1`.
- Editing context: `c6b2a37f-9e88-4d4a-b46f-cc350e142d80`.
- Package/root: `738907af-25b2-4240-83f9-ce0a58a41ac7` (`Batmobile`).

| Tool                             | Arguments beyond `editing_context_id` | Observed data                                                                   |
| -------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------- |
| `syson_requirements_list`        | `root_id` = package/root              | 7 authored requirements, exact available documentation and extraction errors    |
| `syson_query_requirements_trace` | `root_id` = package/root              | 7 traces, including row-level authored constraints and unresolved relationships |
| `syson_constraint_validate`      | `element_id` = package/root           | 12 constraints, 10 explicit error diagnostics and 2 unresolved constraints      |

Captured on 2026-10-25 the same way, with mcp-syson 0.9.1, for the README viewer
captures (`docs/fixtures/viewer-preview.html` delivers them as a host does):

| File                                          | Tool and arguments beyond `editing_context_id`                                                     | Observed data                                   |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `syson_element_children.json`                 | `syson_element_children`, `element_id` = package/root                                              | 39 direct elements                              |
| `syson_query_eval.json`                       | `syson_query_eval`, `aql:self.eAllContents(sysml::PartUsage)` on part definition `Batmobile`       | 10 part and interface usages                    |
| `syson_value_set.json`                        | `syson_value_set`, `Wheel::width` from 26 to 28 (set back to 26 afterwards)                        | read-back matches                               |
| `syson_element_get.json`                      | `syson_element_get`, `element_id` = `Wheel::width`                                                 | the attribute's name and kind                   |
| `syson_constraint_validate_drone_budget.json` | `syson_constraint_validate`, `element_id` = part definition `DroneBudget` (package `Drone budget`) | 4 constraints: 3 pass, 1 fail, margins included |

Diagnostics project the constraints' explicit `error` fields. Their element is
attributed to the validation scope; it is not a claimed discovery of each
constraint's affected owner. Verification and requirement coverage remain
unknown when the provider has not established them.

`tests/ui_live_contracts_test.ts` checks the advertised output schemas and the
same guards used to admit live results in the viewers. Runtime logs and
screenshots are retained outside the repository in
`ux-audit-host/phase2-verification/`.
