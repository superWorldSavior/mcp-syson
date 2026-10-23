/** Caller-owned retained levels; only explicit opening performs a provider read. */
export interface ModelElement {
  id: string;
  kind: string;
  label: string;
}
export interface ChildrenData extends Record<string, unknown> {
  parentId: string;
  editingContextId?: string;
  children: ModelElement[];
  count: number;
}
export interface ModelLevel {
  data: ChildrenData;
  label: string;
  filter: string;
  scrollTop: number;
}
export interface NavigationSnapshot {
  levels: readonly ModelLevel[];
  loading: boolean;
  error?: string;
}
export function createModelNavigation(root: ChildrenData) {
  let epoch = 0;
  let snapshot: NavigationSnapshot = {
    levels: [{ data: root, label: root.parentId, filter: "", scrollTop: 0 }],
    loading: false,
  };
  const listeners = new Set<() => void>();
  const publish = (next: NavigationSnapshot) => {
    snapshot = next;
    listeners.forEach((listener) => listener());
  };
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    reset(data: ChildrenData) {
      epoch++;
      publish({
        levels: [{ data, label: data.parentId, filter: "", scrollTop: 0 }],
        loading: false,
      });
    },
    retain(filter: string, scrollTop: number) {
      const levels = [...snapshot.levels];
      levels[levels.length - 1] = {
        ...levels[levels.length - 1],
        filter,
        scrollTop,
      };
      publish({ ...snapshot, levels });
    },
    back(index: number) {
      if (index < 0 || index >= snapshot.levels.length) return;
      epoch++;
      publish({ levels: snapshot.levels.slice(0, index + 1), loading: false });
    },
    async open(
      element: ModelElement,
      load: (id: string) => Promise<ChildrenData>,
    ) {
      if (snapshot.loading) return;
      const request = ++epoch;
      const levels = snapshot.levels;
      const existing = levels.findIndex((level) =>
        level.data.parentId === element.id
      );
      if (existing >= 0) {
        publish({ levels: levels.slice(0, existing + 1), loading: false });
        return;
      }
      publish({ ...snapshot, loading: true, error: undefined });
      try {
        const data = await load(element.id);
        if (request !== epoch) return;
        if (data.parentId !== element.id) {
          throw new Error("Unexpected model parent");
        }
        const editingContextId = levels[0].data.editingContextId;
        if (
          editingContextId && data.editingContextId &&
          data.editingContextId !== editingContextId
        ) {
          throw new Error("Unexpected editing context");
        }
        publish({
          levels: [...snapshot.levels, {
            data,
            label: element.label || element.id,
            filter: "",
            scrollTop: 0,
          }],
          loading: false,
        });
      } catch (cause) {
        if (request !== epoch) return;
        publish({
          levels: snapshot.levels,
          loading: false,
          error: cause instanceof Error ? cause.message : String(cause),
        });
      }
    },
  };
}
export type ModelNavigation = ReturnType<typeof createModelNavigation>;
