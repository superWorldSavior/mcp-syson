import {
  defineSemanticSelection,
  emitSemanticSelection,
} from "@casys/mcp-view";
import type { ResultData } from "@casys/mcp-view";
import { useEffect, useState } from "preact/hooks";
import type { SurfaceAppContext } from "./preact-surface.tsx";
import {
  createSelectionController,
  type SelectionController,
} from "./selection.ts";

// The kit remounts surfaces on locale/navigation changes. App identity outlives them.
const baskets = new WeakMap<object, SelectionController>();
export function getSysonSelection<T extends ResultData>(
  context: SurfaceAppContext<T>,
  rootId: string,
): SelectionController {
  let controller = baskets.get(context.app);
  if (!controller) {
    const modalities = context.capabilities.updateModelContext;
    controller = createSelectionController({
      rootId,
      enabled: Boolean(modalities?.text || modalities?.structuredContent),
      updateModelContext: (payload) =>
        context.app.updateModelContext({
          ...(modalities?.text ? { content: payload.content } : {}),
          ...(modalities?.structuredContent
            ? { structuredContent: payload.structuredContent }
            : {}),
        }),
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
  return controller;
}

export function useSysonSelection<T extends ResultData>(
  context: SurfaceAppContext<T>,
  rootId: string,
) {
  const controller = getSysonSelection(context, rootId);
  const [snapshot, setSnapshot] = useState(controller.getSnapshot());
  useEffect(() => {
    const unsubscribe = controller.subscribe(() =>
      setSnapshot(controller.getSnapshot())
    );
    void controller.setRoot(rootId);
    setSnapshot(controller.getSnapshot());
    return unsubscribe;
  }, [controller, rootId]);
  return { controller, snapshot };
}
