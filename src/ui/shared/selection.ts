/** SysON domain mapping; all ACK, queue, retry, batch and scope state belongs to mcpview. */
import {
  type ActiveContextHost,
  type ActiveContextHostCapabilities,
  type ClickIntentOptions,
  type ContextSelectionItem,
  createActiveContextController,
  createActiveContextPolicy,
  createClickIntentArbiter,
} from "@mcpview/view/context";

export interface SelectionReference {
  readonly domain: string;
  readonly kind: string;
  readonly id: string;
  readonly basisFingerprint?: string;
}
export interface SelectionItem {
  readonly reference: SelectionReference;
  readonly label: string;
  readonly summary?: string;
  readonly kind?: string;
  readonly owner?: string;
  readonly values?: Readonly<Record<string, string | number | boolean>>;
}
export interface SelectionSnapshot {
  readonly rootId: string;
  readonly available: boolean;
  readonly items: readonly SelectionItem[];
  readonly desired: readonly SelectionItem[];
  readonly pending: boolean;
  readonly error?: string;
}
export type SelectionContextPayload = Parameters<
  ActiveContextHost["updateModelContext"]
>[0];
export const selectionKey = (item: SelectionItem): string =>
  JSON.stringify([
    item.reference.domain,
    item.reference.kind,
    item.reference.id,
  ]);

function toContext(item: SelectionItem): ContextSelectionItem {
  return {
    id: selectionKey(item),
    view: "SysON elements",
    reconcileKey: "elements",
    label: item.label,
    value: item.summary,
    ref: { ...item.reference },
    fields: [
      { label: "Kind", value: item.kind ?? item.reference.kind },
      ...(item.owner ? [{ label: "Owner", value: item.owner }] : []),
      ...Object.entries(item.values ?? {}).slice(0, 3).map((
        [label, value],
      ) => ({ label, value: String(value) })),
    ],
    metadata: item,
  };
}
function fromContext(item: ContextSelectionItem): SelectionItem {
  return item.metadata as SelectionItem;
}

export function createSelectionController(options: {
  rootId: string;
  /** Required for >8 items: rootId is a UI scope, not necessarily an editing context. */
  editingContextId?: string;
  /** Supply context.capabilities from the existing App hook for text-only hosts. */
  hostCapabilities?: ActiveContextHostCapabilities;
  updateModelContext: (payload: SelectionContextPayload) => Promise<unknown>;
  enabled?: boolean;
  onConfirmed?: (items: readonly SelectionItem[]) => void;
  /** Same arbitration instance survives row rerenders; default pointer delay is 500ms. */
  gestureOptions?: ClickIntentOptions;
}) {
  let rootId = options.rootId;
  let editingContextId = options.editingContextId;
  const policy = createActiveContextPolicy({
    schema: "syson.context-selection.v2",
    version: 2,
    maxItems: 1000,
    compactUpTo: 3,
    referenceUpTo: 8,
    maxResourceBytes: 5 * 1024 * 1024,
    maxTextFallbackBytes: 32 * 1024,
    maxSnapshotBytes: 32 * 1024,
    limits: {
      id: 2048,
      view: 120,
      label: 256,
      value: 1024,
      fields: 5,
      fieldLabel: 80,
      fieldValue: 1024,
      resourceUri: 2048,
      resourceMimeType: 120,
    },
    reference(item) {
      const entry = fromContext(item);
      return { ...item, value: entry.kind ?? item.value };
    },
    query(items) {
      if (!editingContextId) {
        throw new TypeError(
          "SysON editingContextId is required for query graduation",
        );
      }
      const references = items.map((item) => fromContext(item).reference);
      if (
        references.some((ref) =>
          !["syson", "sysml"].includes(ref.domain) ||
          !["element", "Requirement", "RequirementUsage"].includes(ref.kind)
        )
      ) {
        throw new TypeError(
          "SysON query graduation requires element references",
        );
      }
      const fingerprints = Object.fromEntries(
        references
          .filter((ref) => ref.basisFingerprint !== undefined)
          .map((ref) => [ref.id, ref.basisFingerprint]),
      );
      return {
        id: "selected-elements",
        view: "SysON elements",
        label: `${items.length} selected elements`,
        query: {
          root: rootId,
          tool: "syson_query_eval",
          arguments: {
            editing_context_id: editingContextId,
            expression: "aql:self",
            selected_object_ids: [...new Set(references.map((ref) => ref.id))],
          },
          ...(Object.keys(fingerprints).length
            ? { basisFingerprints: fingerprints }
            : {}),
        },
      };
    },
  });
  const core = createActiveContextController(
    {
      getHostCapabilities: () =>
        options.enabled === false ? undefined : options.hostCapabilities ??
          { updateModelContext: { structuredContent: {} } },
      updateModelContext: options.updateModelContext,
    },
    rootId,
    policy,
  );
  const actions = () => core.actionsForScope(rootId);
  const clickIntents = createClickIntentArbiter(options.gestureOptions);
  const getSnapshot = (): SelectionSnapshot => {
    const snapshot = core.getSnapshot();
    return {
      rootId,
      available: snapshot.supported,
      items: snapshot.selections.map((selection) =>
        fromContext(selection.item)
      ),
      desired: snapshot.desiredSelections.map((selection) =>
        fromContext(selection.item)
      ),
      pending: snapshot.pending,
      error: snapshot.error?.message,
    };
  };
  async function finish(
    operation: Promise<unknown> | undefined,
  ): Promise<void> {
    const result = await operation;
    if (result === "shared" || result === "cleared" || result === "context") {
      try {
        options.onConfirmed?.(getSnapshot().items);
      } catch { /* Event routing cannot reject an ACK. */ }
    }
  }
  const controller = {
    getSnapshot,
    scopeVersion: () => core.scopeVersion(),
    subscribe: core.subscribe,
    clickIntents,
    isSelected: (item: SelectionItem) => actions().isSelected(toContext(item)),
    isDesired: (item: SelectionItem) => actions().isDesired(toContext(item)),
    selectionState: (item: SelectionItem) =>
      actions().selectionState(toContext(item)),
    previewToggle(item: SelectionItem) {
      const preview = actions().previewToggle(toContext(item));
      return {
        cancel: preview.cancel,
        commit: () => finish(Promise.resolve(preview.commit())),
      };
    },
    itemRevision: (item: SelectionItem) =>
      actions().itemRevision(toContext(item)),
    toggle: (item: SelectionItem) => finish(actions().toggle(toContext(item))),
    setItem: (item: SelectionItem, selected: boolean) =>
      finish(actions().select([toContext(item)], selected ? "add" : "remove")),
    setItems: (
      batch: readonly SelectionItem[],
      mode: "add" | "replace" | "remove" = "add",
    ) => finish(actions().select(batch.map(toContext), mode)),
    remove: (item: SelectionItem) =>
      finish(actions().select([toContext(item)], "remove")),
    clear: () => finish(actions().clear()),
    retry: () => finish(core.retry()),
    setRoot(nextRoot: string) {
      if (rootId === nextRoot) return Promise.resolve();
      clickIntents.cancelAll();
      rootId = nextRoot;
      core.setScope(nextRoot);
      return finish(core.clearPreviousScope());
    },
    reconcile: (present: readonly SelectionItem[]) =>
      finish(actions().reconcileGroup("elements", present.map(toContext))),
    settled: core.settled,
    configureScope(nextRoot: string, nextEditingContextId?: string) {
      editingContextId = nextEditingContextId;
      return controller.setRoot(nextRoot);
    },
    core,
    dispose() {
      clickIntents.dispose();
      return finish(core.dispose());
    },
  };
  return controller;
}
export type SelectionController = ReturnType<typeof createSelectionController>;
