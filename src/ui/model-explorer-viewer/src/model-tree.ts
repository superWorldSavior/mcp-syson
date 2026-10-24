/**
 * Expandable model tree for the explorer: children load lazily on first
 * expansion and stay cached; a failed load can be retried by expanding again.
 * Pure state, no rendering, so the tree survives locale remounts.
 */
import type { ModelElement } from "./navigation.ts";

export interface TreeNodeState {
  readonly status: "loading" | "loaded" | "error";
  readonly children?: readonly ModelElement[];
  readonly error?: string;
}

export interface VisibleTreeNode {
  readonly element: ModelElement;
  readonly depth: number;
  readonly parentId?: string;
}

export function createModelTree(
  load: (id: string) => Promise<readonly ModelElement[]>,
) {
  const nodes = new Map<string, TreeNodeState>();
  const expanded = new Set<string>();
  const listeners = new Set<() => void>();
  let generation = 0;
  const emit = () => listeners.forEach((listener) => listener());

  async function fetchChildren(id: string) {
    const started = generation;
    nodes.set(id, { status: "loading" });
    emit();
    try {
      const children = await load(id);
      if (started !== generation) return;
      nodes.set(id, { status: "loaded", children });
    } catch (error) {
      if (started !== generation) return;
      nodes.set(id, {
        status: "error",
        error: error instanceof Error ? error.message : String(error),
      });
    }
    emit();
  }

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    isExpanded: (id: string) => expanded.has(id),
    node: (id: string) => nodes.get(id),
    /** Known to have no children: the toggle disappears. */
    isLeaf: (id: string) => {
      const state = nodes.get(id);
      return state?.status === "loaded" && state.children?.length === 0;
    },
    expand(id: string) {
      if (expanded.has(id) && nodes.get(id)?.status !== "error") return;
      expanded.add(id);
      const state = nodes.get(id);
      if (!state || state.status === "error") void fetchChildren(id);
      else emit();
    },
    collapse(id: string) {
      if (!expanded.delete(id)) return;
      emit();
    },
    toggle(id: string) {
      if (expanded.has(id) && nodes.get(id)?.status !== "error") {
        this.collapse(id);
      } else {
        this.expand(id);
      }
    },
    reset() {
      generation += 1;
      nodes.clear();
      expanded.clear();
      emit();
    },
  };
}

export type ModelTree = ReturnType<typeof createModelTree>;

/**
 * Visible rows in display order. With a predicate, a node stays visible when
 * it matches or when one of its loaded, expanded descendants does.
 */
export function visibleTreeNodes(
  roots: readonly ModelElement[],
  tree: Pick<ModelTree, "isExpanded" | "node">,
  matches: (element: ModelElement) => boolean = () => true,
  depth = 0,
  parentId?: string,
): VisibleTreeNode[] {
  const rows: VisibleTreeNode[] = [];
  for (const element of roots) {
    const state = tree.node(element.id);
    const descendants = tree.isExpanded(element.id) && state?.children
      ? visibleTreeNodes(state.children, tree, matches, depth + 1, element.id)
      : [];
    if (matches(element) || descendants.length) {
      rows.push({ element, depth, parentId }, ...descendants);
    }
  }
  return rows;
}
