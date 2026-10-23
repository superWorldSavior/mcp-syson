import { assert, assertEquals } from "@std/assert";
import {
  createSelectionController,
  type SelectionContextPayload,
  type SelectionItem,
} from "../src/ui/shared/selection.ts";
import { createSelectionGesture } from "../src/ui/shared/selection-gesture.ts";
const a: SelectionItem = {
  reference: { domain: "syson", kind: "element", id: "a" },
  label: "A",
};
const b: SelectionItem = {
  reference: { domain: "syson", kind: "element", id: "b" },
  label: "B",
};
function deferred() {
  let resolve!: (value?: unknown) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<unknown>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const tick = async () => {
  await Promise.resolve();
  await Promise.resolve();
};
Deno.test("selection only confirms ACKs and serializes full replacements", async () => {
  const calls: SelectionContextPayload[] = [];
  const gates = [deferred(), deferred()];
  const c = createSelectionController({
    rootId: "model",
    updateModelContext: (p) => {
      calls.push(p);
      return gates[calls.length - 1].promise;
    },
  });
  const first = c.toggle(a);
  const second = c.toggle(b);
  await tick();
  assertEquals(calls.length, 1);
  assertEquals(c.getSnapshot().items, []);
  assert(c.getSnapshot().pending);
  gates[0].resolve();
  await first;
  await tick();
  assertEquals(calls.length, 2);
  assertEquals(c.getSnapshot().items, [a]);
  assertEquals(calls[1].structuredContent.items, [a, b]);
  gates[1].resolve();
  await second;
  assertEquals(c.getSnapshot().items, [a, b]);
  assertEquals(c.getSnapshot().pending, false);
});
Deno.test("rejection is visible, unconfirmed, and retry resends refused intent", async () => {
  let refuse = true;
  const c = createSelectionController({
    rootId: "model",
    updateModelContext: () =>
      refuse ? Promise.reject(new Error("refused")) : Promise.resolve(),
  });
  await c.toggle(a);
  assertEquals(c.getSnapshot().items, []);
  assertEquals(c.getSnapshot().desired, []);
  assertEquals(c.getSnapshot().error, "refused");
  refuse = false;
  await c.retry();
  assertEquals(c.getSnapshot().items, [a]);
});
Deno.test("old ACK cannot populate changed root; new clear waits for old request", async () => {
  const old = deferred();
  const calls: SelectionContextPayload[] = [];
  const c = createSelectionController({
    rootId: "old",
    updateModelContext: (p) => {
      calls.push(p);
      return calls.length === 1 ? old.promise : Promise.resolve();
    },
  });
  void c.toggle(a);
  await tick();
  const reset = c.setRoot("new");
  void c.toggle(b);
  assertEquals(calls.length, 1);
  old.resolve();
  await reset;
  await c.settled();
  assertEquals(calls.map((p) => p.structuredContent.rootId), [
    "old",
    "new",
    "new",
  ]);
  assertEquals(calls[1].structuredContent.items, []);
  assertEquals(c.getSnapshot().items, [b]);
});
Deno.test("native double click compensates only its identity across rerenders", async () => {
  const c = createSelectionController({
    rootId: "model",
    updateModelContext: () => Promise.resolve(),
  });
  let opens = 0;
  createSelectionGesture(c, a, () => {
    opens++;
  }).onClick({ detail: 1 });
  void c.toggle(b);
  const rerendered = createSelectionGesture(c, a, () => {
    opens++;
  });
  rerendered.onClick({ detail: 2 });
  rerendered.onDoubleClick();
  await c.settled();
  assertEquals(c.getSnapshot().items, [b]);
  assertEquals(opens, 1);
  await c.toggle(a);
  const g = createSelectionGesture(c, a, () => {
    opens++;
  });
  g.onClick({ detail: 1 });
  g.onClick({ detail: 2 });
  g.onDoubleClick();
  await c.settled();
  assert(c.isSelected(a));
  assertEquals(opens, 2);
});
Deno.test("double click with failed first mutation preserves pregesture choice", async () => {
  let fail = false;
  let opens = 0;
  const c = createSelectionController({
    rootId: "model",
    updateModelContext: () =>
      fail ? Promise.reject(new Error("rejected")) : Promise.resolve(),
  });
  await c.toggle(a);
  fail = true;
  const g = createSelectionGesture(c, a, () => {
    opens++;
  });
  g.onClick({ detail: 1 });
  await c.settled();
  fail = false;
  g.onClick({ detail: 2 });
  g.onDoubleClick();
  await c.settled();
  assert(c.isSelected(a));
  assertEquals(opens, 1);
});
Deno.test("keyboard Space toggles, Enter opens, stale root handlers do nothing", async () => {
  const c = createSelectionController({
    rootId: "one",
    updateModelContext: () => Promise.resolve(),
  });
  let opens = 0;
  let prevented = 0;
  const g = createSelectionGesture(c, a, () => {
    opens++;
  });
  const key = (key: string) => ({
    key,
    preventDefault() {
      prevented++;
    },
  });
  g.onKeyDown(key(" "));
  await c.settled();
  g.onKeyDown(key("Enter"));
  assert(c.isSelected(a));
  assertEquals(opens, 1);
  assertEquals(prevented, 2);
  await c.setRoot("two");
  await c.setRoot("one");
  g.onClick({ detail: 1 });
  g.onKeyDown(key("Enter"));
  await c.settled();
  assertEquals(c.getSnapshot().items, []);
  assertEquals(opens, 1);
});
Deno.test("a failed request does not erase a newer selection intent", async () => {
  const gate = deferred();
  let calls = 0;
  const c = createSelectionController({
    rootId: "model",
    updateModelContext: () => ++calls === 1 ? gate.promise : Promise.resolve(),
  });
  void c.toggle(a);
  void c.toggle(b);
  await tick();
  gate.reject(new Error("first refused"));
  await c.settled();
  assertEquals(c.getSnapshot().items, [a, b]);
  assertEquals(c.getSnapshot().error, undefined);
});

Deno.test("remove, reconcile and clear replace the entire context including an empty basket", async () => {
  const calls: SelectionContextPayload[] = [];
  const c = createSelectionController({
    rootId: "model",
    updateModelContext: (p) => {
      calls.push(p);
      return Promise.resolve();
    },
  });
  await c.toggle(a);
  await c.toggle(b);
  await c.remove(a);
  assertEquals(calls.at(-1)?.structuredContent.items, [b]);
  await c.reconcile([a]);
  assertEquals(c.getSnapshot().items, []);
  await c.toggle(a);
  await c.clear();
  assertEquals(calls.at(-1)?.structuredContent.items, []);
});

Deno.test("a later same-identity choice is not overwritten by double-click compensation", async () => {
  const c = createSelectionController({
    rootId: "model",
    updateModelContext: () => Promise.resolve(),
  });
  const g = createSelectionGesture(c, a, () => {});
  g.onClick({ detail: 1 });
  await c.remove(a);
  await c.toggle(a);
  g.onDoubleClick();
  await c.settled();
  assert(c.isSelected(a));
});

Deno.test("detail failure does not reject or change selection", async () => {
  const c = createSelectionController({
    rootId: "model",
    updateModelContext: () => Promise.resolve(),
  });
  const errors: unknown[] = [];
  const failure = new Error("detail unavailable");
  const g = createSelectionGesture(
    c,
    a,
    () => Promise.reject(failure),
    (error) => errors.push(error),
  );
  g.onKeyDown({ key: "Enter", preventDefault() {} });
  await tick();
  assertEquals(errors, [failure]);
  assertEquals(c.getSnapshot().items, []);
});

Deno.test("bounded labels and summaries preserve semantic identity in the host payload", async () => {
  let payload!: SelectionContextPayload;
  const c = createSelectionController({
    rootId: "model",
    updateModelContext: (p) => {
      payload = p;
      return Promise.resolve();
    },
  });
  await c.toggle({ ...a, label: "L".repeat(900), summary: "S".repeat(4000) });
  const sent = (payload.structuredContent.items as SelectionItem[])[0];
  assertEquals(sent.label.length, 256);
  assertEquals(sent.summary?.length, 1024);
  assertEquals(sent.reference, a.reference);
});

Deno.test("unsupported context hosts expose unavailable and root clear never pretends an ACK", async () => {
  let calls = 0;
  const c = createSelectionController({
    rootId: "one",
    enabled: false,
    updateModelContext: () => {
      calls++;
      return Promise.resolve();
    },
  });
  assertEquals(c.getSnapshot().available, false);
  await c.toggle(a);
  assertEquals(c.getSnapshot().items, []);
  assertEquals(c.getSnapshot().error, "Context updates are unavailable");
  await c.setRoot("two");
  assertEquals(c.getSnapshot().available, false);
  assertEquals(c.getSnapshot().pending, false);
  assertEquals(c.getSnapshot().error, "Context updates are unavailable");
  assertEquals(calls, 0);
});

Deno.test("fingerprint and semantic identity are preserved verbatim", async () => {
  let payload!: SelectionContextPayload;
  const reference = {
    domain: "syson",
    kind: "element",
    id: "semantic/42",
    basisFingerprint: "b".repeat(64),
  };
  const c = createSelectionController({
    rootId: "project",
    updateModelContext: (p) => {
      payload = p;
      return Promise.resolve();
    },
  });
  await c.toggle({ reference, label: "Translated label" });
  assertEquals(
    (payload.structuredContent.items as SelectionItem[])[0].reference,
    reference,
  );
});

Deno.test("batch add is one acknowledged snapshot, deduplicates canonical refs, and preserves basket entries", async () => {
  const calls: SelectionContextPayload[] = [];
  const gate = deferred();
  const c = createSelectionController({
    rootId: "model",
    updateModelContext: (p) => {
      calls.push(p);
      return calls.length === 1 ? Promise.resolve() : gate.promise;
    },
  });
  await c.toggle(a);
  const bLatest = {
    ...b,
    reference: { ...b.reference, basisFingerprint: "f".repeat(64) },
    label: "B latest",
  };
  const batch = c.setItems([b, bLatest, a]);
  await tick();
  assertEquals(calls.length, 2);
  assertEquals(c.getSnapshot().items, [a]);
  assert(c.getSnapshot().pending);
  assertEquals(calls[1].structuredContent.items, [a, bLatest]);
  gate.resolve();
  await batch;
  assertEquals(c.getSnapshot().items, [a, bLatest]);
});

Deno.test("batch replace/remove each send a full snapshot and only confirm accepted membership", async () => {
  const calls: SelectionContextPayload[] = [];
  const c = createSelectionController({
    rootId: "model",
    updateModelContext: (p) => {
      calls.push(p);
      return Promise.resolve();
    },
  });
  await c.setItems([a, b]);
  await c.setItems([a, a], "replace");
  assertEquals(c.getSnapshot().items, [a]);
  await c.setItems([a, a], "remove");
  assertEquals(c.getSnapshot().items, []);
  assertEquals(calls.length, 3);
  assertEquals(calls[2].structuredContent.items, []);
});

Deno.test("a rejected batch exposes failure and retries the complete deduplicated intent", async () => {
  let fail = false;
  const c = createSelectionController({
    rootId: "model",
    updateModelContext: () =>
      fail ? Promise.reject(new Error("batch rejected")) : Promise.resolve(),
  });
  await c.toggle(a);
  fail = true;
  await c.setItems([b, b]);
  assertEquals(c.getSnapshot().items, [a]);
  assertEquals(c.getSnapshot().desired, [a]);
  assertEquals(c.getSnapshot().error, "batch rejected");
  fail = false;
  await c.retry();
  assertEquals(c.getSnapshot().items, [a, b]);
});

Deno.test("an old-root batch ACK cannot restore old selections over the new-root batch", async () => {
  const gate = deferred();
  const calls: SelectionContextPayload[] = [];
  const c = createSelectionController({
    rootId: "old",
    updateModelContext: (p) => {
      calls.push(p);
      return calls.length === 1 ? gate.promise : Promise.resolve();
    },
  });
  void c.setItems([a, b]);
  await tick();
  void c.setRoot("new");
  void c.setItems([b, b]);
  gate.resolve();
  await c.settled();
  assertEquals(calls.length, 3);
  assertEquals(calls[1].structuredContent.items, []);
  assertEquals(c.getSnapshot().rootId, "new");
  assertEquals(c.getSnapshot().items, [b]);
});
