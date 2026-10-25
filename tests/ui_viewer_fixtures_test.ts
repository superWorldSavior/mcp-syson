import { assertEquals } from "@std/assert";
import {
  adaptRequirementsRecordedContent,
  isDiagramSnapshot,
  isRequirementsCaptureReadModel,
  isRequirementsTrace,
} from "../src/ui/shared/recorded-content.ts";
import { parseSysonRecordedViewSession } from "../src/ui/shared/recorded-session.ts";
import {
  buildDiagramSession,
  buildRequirementsSession,
  DIAGRAM_VIEWS,
} from "../scripts/build-viewer-fixtures.ts";

Deno.test(
  "requirements-session.json is accepted by parseSysonRecordedViewSession with the viewer's validate/adapt pair",
  async () => {
    const committed = await Deno.readTextFile(
      new URL(
        "../docs/fixtures/requirements-session.json",
        import.meta.url,
      ).pathname,
    );
    const json = JSON.parse(committed);
    const parsed = await parseSysonRecordedViewSession(
      "requirements",
      json,
      isRequirementsCaptureReadModel,
      adaptRequirementsRecordedContent,
    );
    assertEquals(
      parsed !== undefined,
      true,
      "fixture should parse successfully",
    );
    assertEquals(
      isRequirementsCaptureReadModel(parsed?.structuredContent),
      true,
    );
    assertEquals(isRequirementsTrace(parsed?.structuredContent), false);
    assertEquals(
      await parseSysonRecordedViewSession(
        "requirementsTrace",
        json,
        isRequirementsTrace,
      ),
      undefined,
      "authored limits belong to their dedicated resource, not trace coverage",
    );
  },
);

Deno.test("authored requirements reject inconsistent or fabricated evidence fields", async () => {
  const session = await buildRequirementsSession();
  const content = adaptRequirementsRecordedContent(
    session.resultSchema as string,
    session.structuredContent,
  )!;
  assertEquals(isRequirementsCaptureReadModel(content), true);
  assertEquals(
    isRequirementsCaptureReadModel({ ...content, count: content.count + 1 }),
    false,
  );
  assertEquals(
    isRequirementsCaptureReadModel({ ...content, satisfied: true }),
    false,
  );
  assertEquals(
    isRequirementsCaptureReadModel({
      ...content,
      requirements: [{ ...content.requirements[0], measuredValue: 0.5 }],
      count: 1,
    }),
    false,
  );
  assertEquals(
    isRequirementsCaptureReadModel({
      ...content,
      requirements: [{
        ...content.requirements[0],
        limit: { value: NaN, unit: "mm" },
      }],
      count: 1,
    }),
    false,
  );
});

Deno.test(
  "docs:viewer-fixtures builder is idempotent (re-running produces byte-identical output)",
  async () => {
    const committed = await Deno.readTextFile(
      new URL(
        "../docs/fixtures/requirements-session.json",
        import.meta.url,
      ).pathname,
    );
    const session = await buildRequirementsSession();
    const rebuilt = JSON.stringify(session, null, 2) + "\n";
    assertEquals(
      rebuilt,
      committed,
      "re-building the fixture must produce exactly the committed bytes",
    );
  },
);

Deno.test("diagram view sessions are the committed snapshots, accepted by the diagram viewer", async () => {
  for (const view of DIAGRAM_VIEWS) {
    const committed = JSON.parse(
      await Deno.readTextFile(
        new URL(
          `../docs/fixtures/diagram-${view}-session.json`,
          import.meta.url,
        )
          .pathname,
      ),
    );
    assertEquals(committed, await buildDiagramSession(view), view);
    const parsed = await parseSysonRecordedViewSession(
      "diagram",
      committed,
      isDiagramSnapshot,
    );
    assertEquals(parsed !== undefined, true, `${view} should parse`);
    assertEquals(
      typeof (parsed?.structuredContent as { viewDefinition?: string })
        .viewDefinition,
      "string",
      view,
    );
  }
});
