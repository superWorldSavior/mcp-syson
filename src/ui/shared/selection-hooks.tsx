/** App-scoped ownership; state and subscription lifecycle belong to MCP View. */
import {
  defineSemanticSelection,
  emitSemanticSelection,
  type ResultData,
} from "@mcpview/view";
import { useActiveContext } from "@mcpview/components/preact/context";
import type { SurfaceAppContext } from "./preact-surface.tsx";
import {
  createSelectionController,
  type SelectionController,
} from "./selection.ts";

const baskets = new WeakMap<object, SelectionController>();
export function getSysonSelection<T extends ResultData>(
  context: SurfaceAppContext<T>,
  rootId: string,
  editingContextId?: string,
): SelectionController {
  let controller = baskets.get(context.app);
  if (!controller) {
    controller = createSelectionController({
      rootId,
      editingContextId,
      hostCapabilities: context.capabilities,
      updateModelContext: (payload) => context.app.updateModelContext(payload),
      onConfirmed: (items) => {
        emitSemanticSelection(
          context,
          defineSemanticSelection({
            mode: items.length ? "replace" : "clear",
            references: items.map((item) => item.reference),
          }),
        );
      },
    });
    baskets.set(context.app, controller);
  }
  void controller.configureScope(rootId, editingContextId);
  return controller;
}

export function useSysonSelection<T extends ResultData>(
  context: SurfaceAppContext<T>,
  rootId: string,
  editingContextId?: string,
) {
  const controller = getSysonSelection(context, rootId, editingContextId);
  // Invalidate pending pointer intents before the shared hook changes scope.
  if (controller.getSnapshot().rootId !== rootId) {
    void controller.setRoot(rootId);
  }
  useActiveContext(controller.core, rootId);
  return { controller, snapshot: controller.getSnapshot() };
}
