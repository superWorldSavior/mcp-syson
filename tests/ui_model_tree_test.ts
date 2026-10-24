import { assertEquals } from "@std/assert";
import {
  createModelTree,
  visibleTreeNodes,
} from "../src/ui/model-explorer-viewer/src/model-tree.ts";

const el = (id: string, kind = "PartDefinition") => ({ id, kind, label: id });

Deno.test("model tree loads children lazily, once, and caches them", async () => {
  const calls: string[] = [];
  const tree = createModelTree((id) => {
    calls.push(id);
    return Promise.resolve(
      id === "vehicle" ? [el("engine"), el("driver")] : [],
    );
  });
  const roots = [el("vehicle"), el("wheel")];
  assertEquals(visibleTreeNodes(roots, tree).map((row) => row.element.id), [
    "vehicle",
    "wheel",
  ]);
  tree.expand("vehicle");
  assertEquals(tree.node("vehicle")?.status, "loading");
  await Promise.resolve();
  await Promise.resolve();
  assertEquals(
    visibleTreeNodes(roots, tree).map((row) => [row.element.id, row.depth]),
    [["vehicle", 0], ["engine", 1], ["driver", 1], ["wheel", 0]],
  );
  tree.collapse("vehicle");
  tree.expand("vehicle");
  assertEquals(calls, ["vehicle"]);
});

Deno.test("an empty load marks a leaf and a failed load is retried", async () => {
  let fail = true;
  const tree = createModelTree((id) =>
    id === "flaky" && fail
      ? Promise.reject(new Error("down"))
      : Promise.resolve([])
  );
  tree.expand("empty");
  await Promise.resolve();
  await Promise.resolve();
  assertEquals(tree.isLeaf("empty"), true);

  tree.expand("flaky");
  await Promise.resolve();
  await Promise.resolve();
  assertEquals(tree.node("flaky")?.status, "error");
  assertEquals(tree.node("flaky")?.error, "down");
  fail = false;
  tree.toggle("flaky");
  await Promise.resolve();
  await Promise.resolve();
  assertEquals(tree.node("flaky")?.status, "loaded");
});

Deno.test("filtering keeps ancestors of matching loaded descendants", async () => {
  const tree = createModelTree((id) =>
    Promise.resolve(id === "vehicle" ? [el("engine", "PartUsage")] : [])
  );
  tree.expand("vehicle");
  await Promise.resolve();
  await Promise.resolve();
  const rows = visibleTreeNodes(
    [el("vehicle"), el("wheel")],
    tree,
    (element) => element.id === "engine",
  );
  assertEquals(rows.map((row) => row.element.id), ["vehicle", "engine"]);
});

Deno.test("a reset drops a load that was still in flight", async () => {
  let resolve!: (children: ReturnType<typeof el>[]) => void;
  const tree = createModelTree(() => new Promise((done) => (resolve = done)));
  tree.expand("vehicle");
  tree.reset();
  resolve([el("engine")]);
  await Promise.resolve();
  await Promise.resolve();
  assertEquals(tree.node("vehicle"), undefined);
  assertEquals(tree.isExpanded("vehicle"), false);
});
