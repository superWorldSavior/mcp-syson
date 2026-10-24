/// <reference lib="deno.ns" />

/**
 * Build docs/fixtures/*-session.json from the committed source constants so
 * the README capture harness is reproducible: same fixture, same handshake,
 * same Chrome invocation always produces the same PNG.
 *
 * Usage: deno task docs:viewer-fixtures
 */

import {
  fingerprintSysonRecordedProjection,
} from "../src/ui/shared/recorded-session.ts";
import {
  SYSON_DIGITAL_THREAD_RESULT_SCHEMAS,
  SYSON_RECORDED_SESSION_SCHEMAS,
  SYSON_RESULT_SCHEMAS,
  SYSON_UI_RESOURCE_URIS,
} from "../src/ui/app-manifest.ts";

// TPS03 StandBackrest identifiers mirror the Digital Thread requirements-scope
// reader test (casys-digital-thread, requirements-definition-scope-reader_test.ts);
// the fixture never invents element ids.
const BACKREST_ID = "20e71742-390d-4c6d-a91c-120debab5aa8";
const USAGE_ID = "122501cd-54d6-4aa9-b6a6-50b361ee2168";

/**
 * Artifact digests are a contract preview, not execution evidence: each one is the
 * SHA-256 of a labelled fixture string, so it is well-formed, stable and obviously
 * derived rather than a hand-typed pattern.
 */
async function fixtureDigest(
  label: string,
  namespace = "tps03",
): Promise<string> {
  const bytes = new TextEncoder().encode(`docs/fixtures/${namespace}:${label}`);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(
    new Uint8Array(hash),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

/**
 * Build the complete recorded session envelope for the requirements
 * viewer with TPS03 stand backrest content. Exported so the fixture test can
 * verify idempotency without re-running the script on disk.
 */
export async function buildRequirementsSession(): Promise<
  Record<string, unknown>
> {
  const archDigest = await fixtureDigest("architecture:r15");
  const seedDigest = await fixtureDigest("seed");
  const artifactDigest = await fixtureDigest("requirements:StandBackrest:r15");
  const structuredContent = {
    schemaVersion: SYSON_DIGITAL_THREAD_RESULT_SCHEMAS.requirements,
    operation: { id: "model.write-requirements", version: "1" },
    trustedRunId: "run:requirements-tps03-r15",
    containerComponent: "StandBackrest",
    partDefName: "StandBackrestRequirements",
    target: {
      elementId: BACKREST_ID,
      kind: "part-definition",
      label: "StandBackrest",
    },
    architectureBasis: {
      snapshotId: "thread:tps03:r15",
      revision: 15,
      fingerprint: archDigest,
    },
    requirements: [
      {
        id: "maxDisplacement",
        name: "Maximum displacement",
        metric: "maxDisplacement",
        operator: "<=",
        limit: { value: 1, unit: "mm" },
      },
      {
        id: "maxVonMises",
        name: "Maximum von Mises stress",
        metric: "maxVonMises",
        operator: "<=",
        limit: { value: 55000000, unit: "Pa" },
      },
    ],
    seed: {
      artifactId: "artifact:seed-tps03",
      fingerprint: { algorithm: "sha256", digest: seedDigest },
      producerRunId: "run:seed-tps03",
    },
    architecture: {
      artifactId: `architecture-${archDigest}`,
      fingerprint: { algorithm: "sha256", digest: archDigest },
      producerRunId: "run:architecture-tps03-r15",
    },
    requirementsElementId: USAGE_ID,
    requirementUsage: { id: USAGE_ID, kind: "RequirementUsage" },
    constraintUsages: [
      {
        id: "constraint-usage:maxDisplacement",
        kind: "ConstraintUsage",
        requirementId: "maxDisplacement",
        sourceId: "constraint-usage:maxDisplacement",
      },
      {
        id: "constraint-usage:maxVonMises",
        kind: "ConstraintUsage",
        requirementId: "maxVonMises",
        sourceId: "constraint-usage:maxVonMises",
      },
    ],
    insertedAt: "2026-08-26T00:00:00.000Z",
  };

  const sessionBase = {
    schemaVersion: SYSON_RECORDED_SESSION_SCHEMAS.requirements,
    resourceUri: SYSON_UI_RESOURCE_URIS.requirements,
    resultSchema: SYSON_DIGITAL_THREAD_RESULT_SCHEMAS.requirements,
    readOnly: true as const,
    basis: {
      projectId: "tps03-stand-assembly",
      projectRevision: 15,
      subjectId: BACKREST_ID,
      thread: { id: "tps03", revision: 15 },
      artifact: {
        id: `requirements-StandBackrest-${artifactDigest}`,
        fingerprint: `sha256:${artifactDigest}`,
      },
    },
    structuredContent,
  };

  const projectionFingerprint = await fingerprintSysonRecordedProjection(
    sessionBase,
  );

  return { ...sessionBase, projectionFingerprint };
}

/**
 * Build the recorded session for the diagram viewer: the FlightModes state
 * machine snapshot recorded from the local audit project
 * (tests/fixtures/diagram-views/state-transition.json). The viewer draws its
 * structured nodes and edges; the server SVG is an empty placeholder.
 */
export async function buildDiagramSession(): Promise<Record<string, unknown>> {
  const snapshot = JSON.parse(
    await Deno.readTextFile(
      new URL(
        "../tests/fixtures/diagram-views/state-transition.json",
        import.meta.url,
      ),
    ),
  );
  const artifactDigest = await fixtureDigest(
    `diagram:${snapshot.diagramId}`,
    "syson-views",
  );
  const sessionBase = {
    schemaVersion: SYSON_RECORDED_SESSION_SCHEMAS.diagram,
    resourceUri: SYSON_UI_RESOURCE_URIS.diagram,
    resultSchema: SYSON_RESULT_SCHEMAS.diagram,
    readOnly: true as const,
    basis: {
      projectId: "mcpview-ux-audit",
      projectRevision: 1,
      subjectId: snapshot.targetObjectId,
      thread: { id: "syson-views", revision: 1 },
      artifact: {
        id: `diagram-${snapshot.diagramId}`,
        fingerprint: `sha256:${artifactDigest}`,
      },
    },
    structuredContent: {
      ...snapshot,
      svg: '<svg xmlns="http://www.w3.org/2000/svg"/>',
      renderer: "local",
    },
  };
  const projectionFingerprint = await fingerprintSysonRecordedProjection(
    sessionBase,
  );
  return { ...sessionBase, projectionFingerprint };
}

if (import.meta.main) {
  const root = new URL("..", import.meta.url).pathname;
  await Deno.mkdir(`${root}docs/fixtures`, { recursive: true });
  for (
    const [name, build] of [
      ["requirements", buildRequirementsSession],
      ["diagram", buildDiagramSession],
    ] as const
  ) {
    const outPath = `${root}docs/fixtures/${name}-session.json`;
    const session = await build();
    await Deno.writeTextFile(outPath, JSON.stringify(session, null, 2) + "\n");
    console.log(`[docs:viewer-fixtures] wrote ${outPath}`);
  }
}
