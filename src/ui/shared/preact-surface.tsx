/**
 * SysON facade over mcp-view-components kit with whole-App recorded-session hydration.
 *
 * The Digital Thread host source-locks the handshake to the exact App identity
 * declared by the versioned manifest, so `info` is fixed to SYSON_VIEW_APP_MANIFEST.
 * Human-facing viewer titles live in the HTML and component surface, not in appInfo.
 */

import { readResultData, type ResultData } from "@casys/mcp-view";
import {
  createTranslator,
  mcpViewMessages,
  readSurfaceContext,
  type ViewComponentDefinition,
  type ViewComponentDescriptor,
  type ViewComponentRegistry,
} from "@casys/mcp-view-components";
import {
  definePreactComponent as defineKitPreactComponent,
  type PreactSurfaceComponentProps,
  type PreactSurfaceContext,
  startPreactSurfaceApp,
  type SurfaceLabel,
} from "@casys/mcp-view-components/preact";
import { installMcpViewFonts } from "@casys/mcp-view-components/fonts";
import { createElement, type FunctionComponent, render } from "preact";
import { CasysCredit } from "./CasysCredit.tsx";
import { SYSON_VIEW_APP_MANIFEST, type SysonViewKey } from "../app-manifest.ts";
import {
  SYSON_MESSAGES_EN,
  SYSON_MESSAGES_FR,
  type SysonMessageKey,
} from "./messages.ts";
import {
  isSysonRecordedViewSessionEnvelope,
  parseSysonRecordedViewSession,
  type SysonRecordedContentAdapter,
  type SysonRecordedViewSession,
} from "./recorded-session.ts";
import { toolResultIssue } from "./tool-result.ts";

export type { SurfaceLabel };

export const sysonMessages = createTranslator({
  defaultLocale: "en",
  messages: SYSON_MESSAGES_EN,
  translations: { fr: SYSON_MESSAGES_FR },
});

export function surfaceLabel(key: SysonMessageKey): SurfaceLabel {
  return (locale) => sysonMessages(locale)(key);
}

/** App-level data carrying the projected content and optional recorded-session origin. */
export interface SysonViewData<TContent extends ResultData> {
  readonly content: TContent;
  readonly recorded?: SysonRecordedViewSession<TContent>;
}

export type SurfaceAppContext<TContent extends ResultData> =
  PreactSurfaceContext<
    SysonViewData<TContent>
  >;

export type SysonViewRegistry<TContent extends ResultData> =
  ViewComponentRegistry<
    SysonViewData<TContent>,
    SurfaceAppContext<TContent>
  >;

/**
 * Wrap one Preact component into the kit registry format.
 * Unwraps the App-level data envelope so every viewer component
 * keeps receiving its plain content directly.
 */
export function definePreactComponent<TContent extends ResultData>(
  descriptor: ViewComponentDescriptor,
  component: FunctionComponent<
    PreactSurfaceComponentProps<TContent, SurfaceAppContext<TContent>>
  >,
): ViewComponentDefinition<
  SysonViewData<TContent>,
  SurfaceAppContext<TContent>
> {
  return defineKitPreactComponent<
    SysonViewData<TContent>,
    SurfaceAppContext<TContent>
  >(
    descriptor,
    (props) => createElement(component, { ...props, data: props.data.content }),
  );
}

interface SysonViewerAppOptions<TContent extends ResultData> {
  readonly root: HTMLElement;
  readonly registry: SysonViewRegistry<TContent>;
  readonly recordedSession: {
    readonly view: SysonViewKey;
    readonly validateContent: (value: unknown) => boolean;
    readonly adaptContent?: SysonRecordedContentAdapter<TContent>;
  };
  readonly loadingLabel?: SurfaceLabel;
  readonly emptyLabel?: SurfaceLabel;
}

/**
 * Start a result-driven SysON viewer App backed by a component registry.
 *
 * The kit's startPreactSurfaceApp owns statuses, host-context remount and
 * surface selection, and stamps `data-casys-surface-*` on the document element.
 * Theme tokens already drive the CSS/DOM, so a theme-only host change stays
 * in place; locale and surface selection still remount.
 */
const viewerCredits = new WeakMap<HTMLElement, HTMLElement>();

export async function startSysonViewerApp<TContent extends ResultData>(
  options: SysonViewerAppOptions<TContent>,
): Promise<void> {
  const { root, registry, recordedSession, loadingLabel, emptyLabel } = options;
  const { view, validateContent, adaptContent } = recordedSession;

  document.documentElement.classList.add("syson-app");
  installMcpViewFonts(root.ownerDocument);

  // The pinned surface API has no footer slot. Keep one sibling outside its
  // remounted surface and all diagram canvas/selection event boundaries.
  let footer = viewerCredits.get(root);
  if (!footer) {
    footer = root.ownerDocument.createElement("footer");
    footer.className = "syson-viewer-credit";
    root.after(footer);
    render(createElement(CasysCredit, {}), footer);
    viewerCredits.set(root, footer);
  }

  await startPreactSurfaceApp({
    root,
    info: {
      name: SYSON_VIEW_APP_MANIFEST.app.id,
      version: SYSON_VIEW_APP_MANIFEST.app.version,
    },
    registry,
    surfaceClassName: "mcp-view-preact-surface syson-component-surface",
    loadingLabel,
    emptyLabel,
    documentLanguage: sysonMessages.locale,
    themeUpdates: "in-place",
    onTeardown: () => {
      render(null, footer);
      footer.remove();
      viewerCredits.delete(root);
    },
    fromToolResult: (result) => {
      const validate = (value: unknown): value is TContent =>
        validateContent(value);
      const content = readResultData<TContent>(result, {
        fallback: "json-text",
        validate,
      });
      const issue = toolResultIssue(result, content !== undefined);
      if (issue) {
        return {
          kind: "error",
          title: (locale) =>
            sysonMessages(locale)(
              issue.kind === "provider"
                ? "toolErrorTitle"
                : "invalidToolDataTitle",
            ),
          code: issue.code,
          message: (locale) =>
            issue.message ||
            sysonMessages(locale)(
              issue.kind === "provider"
                ? "toolErrorTitle"
                : "invalidToolDataMessage",
            ),
        };
      }
      return content
        ? { kind: "result", result: { content } }
        : { kind: "empty" };
    },
    viewerSession: {
      validate: (value): value is unknown =>
        isSysonRecordedViewSessionEnvelope(
          view,
          value,
          validateContent,
          adaptContent,
        ),
      toState: async (value) => {
        const session = await parseSysonRecordedViewSession<TContent>(
          view,
          value,
          validateContent,
          adaptContent,
        );
        if (!session) {
          return {
            kind: "error",
            title: (locale) => mcpViewMessages(locale)("sessionRejectedTitle"),
            code: "session-rejected",
            message: (locale) =>
              sysonMessages(locale)("sessionRejected", { view }),
          };
        }
        return {
          kind: "result",
          result: { content: session.structuredContent, recorded: session },
        };
      },
    },
    onError: (error) =>
      console.error("[mcp-syson] Component surface failed", error),
  });
}

/** Preserve model context and emit the optional routed Compose event. */
export function publishSelection<TContent extends ResultData>(
  context: SurfaceAppContext<TContent>,
  modelEvent: string,
  composeEvent: string,
  data: Record<string, unknown>,
): void {
  if (context.capabilities.updateModelContext) {
    void context.app.updateModelContext({
      content: [{
        type: "text",
        text: `User ${modelEvent}: ${JSON.stringify(data)}`,
      }],
      structuredContent: { event: modelEvent, ...data },
    }).catch((error) => {
      console.warn("[mcp-syson] Model context update failed", error);
    });
  }

  if (
    readSurfaceContext(context.hostContext)?.eventChannel ===
      "ui/compose/event"
  ) {
    context.events?.emit(composeEvent, data);
  }
}
