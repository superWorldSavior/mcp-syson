import { assertEquals } from "@std/assert";
import {
  type ChildrenData,
  createModelNavigation,
} from "../src/ui/model-explorer-viewer/src/navigation.ts";
const root: ChildrenData = {
  parentId: "root",
  editingContextId: "ec",
  count: 1,
  children: [{ id: "part", label: "Part", kind: "PartUsage" }],
};
const child: ChildrenData = {
  parentId: "part",
  editingContextId: "ec",
  count: 0,
  children: [],
};
Deno.test("model navigation retains parent filter and scroll through empty child and back", async () => {
  const navigation = createModelNavigation(root);
  navigation.retain("Part", 173);
  let calls = 0;
  await navigation.open(root.children[0], (id) => {
    calls++;
    assertEquals(id, "part");
    return Promise.resolve(child);
  });
  assertEquals(calls, 1);
  assertEquals(navigation.getSnapshot().levels[1].data.children, []);
  navigation.back(0);
  assertEquals(navigation.getSnapshot().levels[0].filter, "Part");
  assertEquals(navigation.getSnapshot().levels[0].scrollTop, 173);
});
Deno.test("model navigation discards late reads after root replacement", async () => {
  const navigation = createModelNavigation(root);
  let finish!: (data: ChildrenData) => void;
  const opening = navigation.open(
    root.children[0],
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const replacement = { ...root, parentId: "other" };
  navigation.reset(replacement);
  finish(child);
  await opening;
  assertEquals(
    navigation.getSnapshot().levels.map((level) => level.data.parentId),
    ["other"],
  );
  assertEquals(navigation.getSnapshot().loading, false);
});
Deno.test("model navigation discards reads cancelled by back, and surfaces failed reads", async () => {
  const navigation = createModelNavigation(root);
  let finish!: (data: ChildrenData) => void;
  const opening = navigation.open(
    root.children[0],
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  navigation.back(0);
  finish(child);
  await opening;
  assertEquals(navigation.getSnapshot().levels.length, 1);
  await navigation.open(
    root.children[0],
    () => Promise.reject(new Error("offline")),
  );
  assertEquals(navigation.getSnapshot().error, "offline");
  assertEquals(navigation.getSnapshot().levels.length, 1);
  await navigation.open(
    root.children[0],
    () => Promise.resolve({ ...child, parentId: "wrong" }),
  );
  assertEquals(navigation.getSnapshot().error, "Unexpected model parent");
});
Deno.test("model navigation preserves edits made while reading and rejects wrong editing context", async () => {
  const navigation = createModelNavigation(root);
  let finish!: (data: ChildrenData) => void;
  const opening = navigation.open(
    root.children[0],
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  navigation.retain("changed while loading", 215);
  finish(child);
  await opening;
  navigation.back(0);
  assertEquals(
    navigation.getSnapshot().levels[0].filter,
    "changed while loading",
  );
  assertEquals(navigation.getSnapshot().levels[0].scrollTop, 215);
  await navigation.open(
    root.children[0],
    () => Promise.resolve({ ...child, editingContextId: "wrong" }),
  );
  assertEquals(navigation.getSnapshot().error, "Unexpected editing context");
  assertEquals(navigation.getSnapshot().levels.length, 1);
});
