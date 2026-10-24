import { assert, assertEquals } from "@std/assert";
import {
  createSelectionController,
  type SelectionContextPayload,
  type SelectionItem,
} from "../src/ui/shared/selection.ts";
import { createSelectionGesture } from "../src/ui/shared/selection-gesture.ts";
/** New wire contract projects compact/reference items; these assertions decode only those tiers. */
function wireItems(payload: SelectionContextPayload): SelectionItem[] {
  return (payload.structuredContent!.items as Array<{
    ref: SelectionItem["reference"];
    label: string;
    value?: string;
  }>).map((item) => ({
    reference: item.ref,
    label: item.label,
    ...(item.value ? { summary: item.value } : {}),
  }));
}
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
  assertEquals(wireItems(calls[1]), [a, b]);
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
  assertEquals(c.getSnapshot().desired, [a]);
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
  assertEquals(calls.length, 3);
  assertEquals(c.getSnapshot().rootId, "new");
  assertEquals(wireItems(calls[1]), []);
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
  assertEquals(wireItems(calls.at(-1)!), [b]);
  await c.reconcile([a]);
  assertEquals(c.getSnapshot().items, []);
  await c.toggle(a);
  await c.clear();
  assertEquals(wireItems(calls.at(-1)!), []);
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
  const sent = wireItems(payload)[0];
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
  assertEquals(c.getSnapshot().error, undefined);
  await c.setRoot("two");
  assertEquals(c.getSnapshot().available, false);
  assertEquals(c.getSnapshot().pending, false);
  assertEquals(c.getSnapshot().error, undefined);
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
    wireItems(payload)[0].reference,
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
  assertEquals(wireItems(calls[1]), [a, bLatest]);
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
  assertEquals(wireItems(calls[2]), []);
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
  assertEquals(c.getSnapshot().desired, [a, b]);
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
  assertEquals(wireItems(calls[1]), []);
  assertEquals(c.getSnapshot().rootId, "new");
  assertEquals(c.getSnapshot().items, [b]);
});

Deno.test("SysON policy graduates compact 1–3, references 4–8, one exact query above eight", async () => {
  for (const count of [1, 3, 4, 8, 9, 50, 743]) {
    let payload!: SelectionContextPayload;
    const c = createSelectionController({
      rootId: "package-root",
      editingContextId: "editing-context",
      updateModelContext: (next) => {
        payload = next;
        return Promise.resolve();
      },
    });
    const items = Array.from({ length: count }, (_, index) => ({
      reference: { domain: "sysml", kind: "element", id: `element-${index}` },
      label: `Element ${index}`,
      kind: "PartUsage",
      owner: "Batmobile",
      values: { length: 80, mass: 20, speed: 30, excluded: 99 },
    }));
    await c.setItems(items);
    assertEquals(c.getSnapshot().error, undefined);
    assertEquals(c.getSnapshot().items.length, count);
    const wire = payload.structuredContent!.items as Array<
      Record<string, unknown>
    >;
    assertEquals(wire.length, count > 8 ? 1 : count);
    if (count <= 3) {
      assertEquals(wire[0].fields, [
        { label: "Kind", value: "PartUsage" },
        { label: "Owner", value: "Batmobile" },
        { label: "length", value: "80" },
        { label: "mass", value: "20" },
        { label: "speed", value: "30" },
      ]);
    } else if (count <= 8) {
      assertEquals(wire[0].fields, undefined);
      assertEquals(wire[0].value, "PartUsage");
    } else {
      assertEquals(wire[0].query, {
        root: "package-root",
        tool: "syson_query_eval",
        arguments: {
          editing_context_id: "editing-context",
          expression: "aql:self",
          selected_object_ids: items.map((item) => item.reference.id),
        },
      });
    }
    assertEquals(wire[0].metadata, undefined);
    await c.dispose();
  }
});

Deno.test("query transport negotiates text and scope changes update the explicit editing context", async () => {
  const calls: SelectionContextPayload[] = [];
  const c = createSelectionController({
    rootId: "old-root",
    editingContextId: "old-context",
    hostCapabilities: { updateModelContext: { text: {} } },
    updateModelContext: (payload) => {
      calls.push(payload);
      return Promise.resolve();
    },
  });
  const many = Array.from({ length: 9 }, (_, index) => ({
    reference: { domain: "sysml", kind: "element", id: `e${index}` },
    label: `E${index}`,
  }));
  await c.setItems(many);
  assertEquals(calls[0].structuredContent, undefined);
  await c.configureScope("new-root", "new-context");
  await c.setItems(many);
  const snapshot = JSON.parse(
    (calls.at(-1)!.content![0] as { text: string }).text,
  );
  assertEquals(snapshot.items[0].query.root, "new-root");
  assertEquals(
    snapshot.items[0].query.arguments.editing_context_id,
    "new-context",
  );
  await c.dispose();
});

Deno.test("large selections refuse to fabricate editing context from the viewer root", async () => {
  let writes = 0;
  const c = createSelectionController({
    rootId: "ui-only-root",
    updateModelContext: () => {
      writes++;
      return Promise.resolve();
    },
  });
  await c.setItems(Array.from({ length: 9 }, (_, index) => ({
    reference: { domain: "sysml", kind: "element", id: String(index) },
    label: String(index),
  })));
  assertEquals(writes, 0);
  assertEquals(c.getSnapshot().items, []);
  assertEquals(
    c.getSnapshot().error,
    "SysON editingContextId is required for query graduation",
  );
  await c.dispose();
});
