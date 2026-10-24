import {
  type SelectionController,
  type SelectionItem,
  selectionKey,
} from "./selection.ts";

/** Shared library arbiter preserves provisional state across HTML/SVG rerenders. */
export function createSelectionGesture(
  controller: SelectionController,
  item: SelectionItem,
  openDetail?: () => void | Promise<unknown>,
  onOpenError?: (error: unknown) => void,
) {
  const root = controller.getSnapshot().rootId;
  const scope = controller.scopeVersion();
  const valid = () =>
    controller.getSnapshot().rootId === root &&
    controller.scopeVersion() === scope;
  const open = () => {
    if (!valid() || !openDetail) return;
    try {
      Promise.resolve(openDetail()).catch((error) => onOpenError?.(error));
    } catch (error) {
      onOpenError?.(error);
    }
  };
  const intent = {
    key: selectionKey(item),
    scope: JSON.stringify([root, scope]),
    onPreview: () => controller.previewToggle(item),
    onSingle: () => controller.toggle(item),
    onDouble: open,
  };
  return {
    onClick(event: { detail: number }) {
      if (!valid()) return;
      controller.clickIntents.click(intent, event.detail);
    },
    onDoubleClick() {
      if (valid() && openDetail) controller.clickIntents.doubleClick(intent);
    },
    onKeyDown(
      event: { key: string; repeat?: boolean; preventDefault(): void },
    ) {
      if (valid()) controller.clickIntents.keyDown(intent, event);
    },
  };
}
