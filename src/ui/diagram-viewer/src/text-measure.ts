/**
 * Canvas `measureText` for block sizing (syson-diagram-design.md §4: block
 * sizes come from our own content measurement). The fonts are the kit's,
 * read from the live `--mcp-view-font-*` tokens; measurement is redone once
 * the embedded web fonts finish loading.
 */
import { useEffect, useMemo, useState } from "preact/hooks";
import {
  approximateMeasure,
  type FontSpec,
  type TextMeasure,
} from "./diagram-scene.ts";

export function canvasTextMeasure(
  families: { readonly body: string; readonly mono: string },
): TextMeasure {
  const context = typeof document === "undefined"
    ? null
    : document.createElement("canvas").getContext("2d");
  if (!context) return approximateMeasure;
  const cache = new Map<string, number>();
  return (text: string, font: FontSpec) => {
    const key = `${font.size}|${font.weight ?? 400}|${font.mono ? "m" : "b"}|${
      font.spacing ?? 0
    }|${text}`;
    let width = cache.get(key);
    if (width === undefined) {
      context.font = `${font.weight ?? 400} ${font.size}px ${
        font.mono ? families.mono : families.body
      }`;
      width = context.measureText(text).width +
        (font.spacing ?? 0) * font.size * text.length;
      cache.set(key, width);
    }
    return width;
  };
}

function fontFamilies() {
  const style = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string) =>
    style.getPropertyValue(name).trim() || fallback;
  return {
    body: read(
      "--mcp-view-font-body",
      getComputedStyle(document.body).fontFamily || "sans-serif",
    ),
    mono: read("--mcp-view-font-mono", "monospace"),
  };
}

/** A stable measurer; a new one (and so a new layout) once fonts are ready. */
export function useTextMeasure(): TextMeasure {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const fonts = document.fonts;
    if (!fonts) return;
    const families = fontFamilies();
    // Faces load on first use: ask for the ones the diagram measures with.
    const wanted = [
      `600 13px ${families.body}`,
      `400 12px ${families.body}`,
      `600 10px ${families.mono}`,
    ];
    let ready = true;
    try {
      ready = wanted.every((font) => fonts.check(font));
    } catch { /* An unparsable family keeps the first measurement. */ }
    if (ready) return;
    let current = true;
    void Promise.all(wanted.map((font) => fonts.load(font).catch(() => [])))
      .then(() => {
        if (current) setVersion((value) => value + 1);
      });
    return () => {
      current = false;
    };
  }, []);
  return useMemo(() => canvasTextMeasure(fontFamilies()), [version]);
}
