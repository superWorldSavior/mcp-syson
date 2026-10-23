/** Serialized, acknowledged context basket. Presentation must use `items` for confirmed state. */
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
}
export interface SelectionSnapshot {
  readonly rootId: string;
  readonly available: boolean;
  readonly items: readonly SelectionItem[];
  readonly desired: readonly SelectionItem[];
  readonly pending: boolean;
  readonly error?: string;
}
export interface SelectionContextPayload {
  readonly content: { type: "text"; text: string }[];
  readonly structuredContent: Record<string, unknown>;
}
export const selectionKey = (item: SelectionItem): string =>
  JSON.stringify([
    item.reference.domain,
    item.reference.kind,
    item.reference.id,
  ]);

export function createSelectionController(options: {
  rootId: string;
  updateModelContext: (payload: SelectionContextPayload) => Promise<unknown>;
  enabled?: boolean;
  onConfirmed?: (items: readonly SelectionItem[]) => void;
}) {
  let rootId = options.rootId;
  let epoch = 0;
  let revision = 0;
  let pending = 0;
  let items: readonly SelectionItem[] = [];
  let desired: readonly SelectionItem[] = [];
  let error: string | undefined;
  let failedIntent: readonly SelectionItem[] | undefined;
  let queue = Promise.resolve();
  const listeners = new Set<() => void>();
  const revisions = new Map<string, number>();
  let snapshot: SelectionSnapshot = {
    rootId,
    available: options.enabled !== false,
    items,
    desired,
    pending: false,
  };
  const notify = () => {
    snapshot = {
      rootId,
      available: options.enabled !== false,
      items,
      desired,
      pending: pending > 0,
      error,
    };
    for (const listener of listeners) listener();
  };
  function replace(next: readonly SelectionItem[]): Promise<void> {
    desired = next;
    const version = ++revision;
    const generation = epoch;
    const requestRoot = rootId;
    pending++;
    error = undefined;
    notify();
    const operation = queue.then(async () => {
      // Superseded roots cannot overwrite the new root; its queued clear follows.
      if (generation !== epoch) return;
      try {
        if (options.enabled === false) {
          throw new Error("Context updates are unavailable");
        }
        const bounded = next.map((item) => ({
          reference: { ...item.reference },
          label: item.label.slice(0, 256),
          ...(item.summary ? { summary: item.summary.slice(0, 1024) } : {}),
        }));
        const structuredContent = {
          schema: "syson.context-selection.v1",
          rootId: requestRoot,
          items: bounded,
        };
        await options.updateModelContext({
          content: [{ type: "text", text: JSON.stringify(structuredContent) }],
          structuredContent,
        });
        if (generation !== epoch) return;
        items = next;
        error = undefined;
        failedIntent = undefined;
        try {
          options.onConfirmed?.(items);
        } catch { /* Optional event routing cannot reject an ACK. */ }
      } catch (cause) {
        if (generation !== epoch) return;
        error = cause instanceof Error ? cause.message : String(cause);
        if (version === revision) {
          failedIntent = next;
          desired = items;
        }
      } finally {
        if (generation === epoch) {
          pending--;
          notify();
        }
      }
    });
    queue = operation.catch(() => {});
    return operation;
  }
  function setItem(item: SelectionItem, selected: boolean): Promise<void> {
    const key = selectionKey(item);
    revisions.set(key, (revisions.get(key) ?? 0) + 1);
    const others = desired.filter((entry) => selectionKey(entry) !== key);
    return replace(selected ? [...others, item] : others);
  }
  const controller = {
    getSnapshot: () => snapshot,
    scopeVersion: () => epoch,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    isSelected(item: SelectionItem) {
      return items.some((entry) => selectionKey(entry) === selectionKey(item));
    },
    isDesired(item: SelectionItem) {
      return desired.some((entry) =>
        selectionKey(entry) === selectionKey(item)
      );
    },
    itemRevision(item: SelectionItem) {
      return revisions.get(selectionKey(item)) ?? 0;
    },
    toggle(item: SelectionItem) {
      return setItem(item, !controller.isDesired(item));
    },
    setItem,
    /** One rectangle/group gesture becomes one full context replacement. */
    setItems(
      batch: readonly SelectionItem[],
      mode: "add" | "replace" | "remove" = "add",
    ) {
      const incoming = new Map(batch.map((item) => [selectionKey(item), item]));
      const next = mode === "replace"
        ? new Map<string, SelectionItem>()
        : new Map(desired.map((item) => [selectionKey(item), item]));
      const touched = new Set(incoming.keys());
      if (mode === "replace") {
        for (const item of desired) touched.add(selectionKey(item));
      }
      for (const [key, item] of incoming) {
        if (mode === "remove") next.delete(key);
        else next.set(key, item);
      }
      for (const key of touched) {
        revisions.set(key, (revisions.get(key) ?? 0) + 1);
      }
      return replace([...next.values()]);
    },
    remove(item: SelectionItem) {
      return setItem(item, false);
    },
    clear() {
      for (const item of desired) {
        revisions.set(selectionKey(item), controller.itemRevision(item) + 1);
      }
      return replace([]);
    },
    retry() {
      return replace(failedIntent ?? desired);
    },
    setRoot(nextRoot: string) {
      if (nextRoot === rootId) return Promise.resolve();
      epoch++;
      rootId = nextRoot;
      pending = 0;
      desired = [];
      items = [];
      revisions.clear();
      failedIntent = undefined;
      return replace([]);
    },
    /** Call only when absence is established, not for a paginated/filtered subset. */
    reconcile(present: readonly SelectionItem[]) {
      const keys = new Set(present.map(selectionKey));
      return replace(desired.filter((item) => keys.has(selectionKey(item))));
    },
    settled: () => queue,
  };
  return controller;
}
export type SelectionController = ReturnType<typeof createSelectionController>;
