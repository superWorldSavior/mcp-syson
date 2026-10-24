import { assertEquals } from "@std/assert";
import { fakeClock } from "./ui_selection_helpers.ts";
import {
  createSelectionController,
  type SelectionContextPayload,
} from "../src/ui/shared/selection.ts";
import { createSelectionGesture } from "../src/ui/shared/selection-gesture.ts";

const item = {
  reference: { domain: "syson", kind: "element", id: "a" },
  label: "A",
};
const tick = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

Deno.test("domain pointer facade previews immediately, commits once at 500ms, and confirms only ACK", async () => {
  const clock = fakeClock();
  const calls: SelectionContextPayload[] = [];
  let acknowledge!: () => void;
  const controller = createSelectionController({
    rootId: "model",
    gestureOptions: { schedule: clock.schedule },
    updateModelContext: (payload) => {
      calls.push(payload);
      return new Promise<void>((resolve) => {
        acknowledge = resolve;
      });
    },
  });
  const gesture = createSelectionGesture(controller, item, () => {});
  gesture.onClick({ detail: 1 });
  assertEquals(controller.selectionState(item), "adding");
  assertEquals(controller.getSnapshot().desired, [item]);
  assertEquals(controller.getSnapshot().items, []);
  assertEquals(controller.getSnapshot().pending, true);
  assertEquals(calls.length, 0);
  clock.advance(499);
  await tick();
  assertEquals(calls.length, 0);
  clock.advance(1);
  await tick();
  assertEquals(calls.length, 1);
  assertEquals(controller.getSnapshot().items, []);
  assertEquals(controller.selectionState(item), "adding");
  acknowledge();
  await controller.settled();
  assertEquals(controller.selectionState(item), "selected");
  assertEquals(controller.getSnapshot().pending, false);
  assertEquals(controller.getSnapshot().items, [item]);
});

Deno.test("domain native double at 200ms cancels both adding and removing preview across rerenders with zero writes", async () => {
  for (const selected of [false, true]) {
    const clock = fakeClock();
    let calls = 0;
    let opens = 0;
    const controller = createSelectionController({
      rootId: "model",
      gestureOptions: { schedule: clock.schedule },
      updateModelContext: () => {
        calls++;
        return Promise.resolve();
      },
    });
    if (selected) await controller.toggle(item);
    calls = 0;
    createSelectionGesture(controller, item, () => {
      opens++;
    }).onClick({ detail: 1 });
    assertEquals(
      controller.selectionState(item),
      selected ? "removing" : "adding",
    );
    assertEquals(controller.getSnapshot().pending, true);
    clock.advance(200);
    const rerendered = createSelectionGesture(controller, item, () => {
      opens++;
    });
    rerendered.onClick({ detail: 2 });
    rerendered.onDoubleClick();
    clock.advance(500);
    await controller.settled();
    assertEquals(calls, 0);
    assertEquals(opens, 1);
    assertEquals(
      controller.selectionState(item),
      selected ? "selected" : "none",
    );
    assertEquals(controller.getSnapshot().items, selected ? [item] : []);
    assertEquals(controller.getSnapshot().desired, selected ? [item] : []);
    assertEquals(controller.getSnapshot().pending, false);
  }
});

Deno.test("domain root transition cancels pointer preview before delayed commit", async () => {
  const clock = fakeClock();
  const calls: SelectionContextPayload[] = [];
  const controller = createSelectionController({
    rootId: "old",
    gestureOptions: { schedule: clock.schedule },
    updateModelContext: (payload) => {
      calls.push(payload);
      return Promise.resolve();
    },
  });
  const gesture = createSelectionGesture(controller, item, () => {});
  gesture.onClick({ detail: 1 });
  await controller.setRoot("new");
  const count = calls.length;
  clock.advance(500);
  gesture.onClick({ detail: 1 });
  await controller.settled();
  assertEquals(calls.length, count);
  assertEquals(controller.getSnapshot().desired, []);
  assertEquals(controller.getSnapshot().items, []);
  assertEquals(controller.getSnapshot().pending, false);
});

Deno.test("domain facade honors configured pointer interval and immediate keyboard activation", async () => {
  const clock = fakeClock();
  let calls = 0;
  const controller = createSelectionController({
    rootId: "model",
    gestureOptions: { schedule: clock.schedule, doubleClickDelayMs: 800 },
    updateModelContext: () => {
      calls++;
      return Promise.resolve();
    },
  });
  const gesture = createSelectionGesture(controller, item, () => {});
  gesture.onClick({ detail: 1 });
  clock.advance(500);
  await tick();
  assertEquals(calls, 0);
  clock.advance(300);
  await controller.settled();
  assertEquals(calls, 1);
  gesture.onKeyDown({ key: " ", preventDefault() {} });
  await controller.settled();
  assertEquals(calls, 2);
  assertEquals(controller.getSnapshot().items, []);
});
