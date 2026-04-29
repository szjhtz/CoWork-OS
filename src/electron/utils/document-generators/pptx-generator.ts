/**
 * PPTX Generator — creates PowerPoint presentations from structured slide data.
 *
 * Uses Codex's bundled @oai/artifact-tool presentation runtime when available.
 * Falls back to pptxgenjs only when the bundled runtime cannot be loaded.
 */

import { execFile } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as fsp from "fs/promises";
import * as os from "os";
import * as path from "path";
import { pathToFileURL } from "url";
import { resolveCodexArtifactToolRuntime } from "../codex-artifact-tool-runtime";

const execFileAsync = promisify(execFile);
const ARTIFACT_TOOL_GENERATION_TIMEOUT_MS = 90_000;

interface SlideDefinition {
  title?: string;
  subtitle?: string;
  bullets?: string[];
  content?: string;
  notes?: string;
  layout?: "title" | "content" | "section" | "blank";
  image?: { path?: string; url?: string; width?: number; height?: number };
}

interface PptxOptions {
  title?: string;
  author?: string;
  subject?: string;
  slides: SlideDefinition[];
  theme?: {
    primaryColor?: string;
    secondaryColor?: string;
    fontFace?: string;
  };
}

export async function generatePPTX(
  outputPath: string,
  options: PptxOptions,
): Promise<{ success: boolean; path: string; size: number; slideCount: number }> {
  try {
    await generatePPTXWithArtifactTool(outputPath, options);
  } catch (error) {
    console.warn(
      "[pptx-generator] Codex artifact-tool generation failed; using pptxgenjs fallback:",
      error instanceof Error ? error.message : error,
    );
    await generatePPTXWithPptxGenJs(outputPath, options);
  }

  const stat = fs.statSync(outputPath);
  return {
    success: true,
    path: outputPath,
    size: stat.size,
    slideCount: options.slides.length,
  };
}

async function generatePPTXWithArtifactTool(
  outputPath: string,
  options: PptxOptions,
): Promise<void> {
  const runtime = await resolveCodexArtifactToolRuntime();
  if (!runtime) {
    throw new Error("bundled @oai/artifact-tool runtime is not available");
  }

  let tempDir: string | undefined;
  try {
    await fsp.mkdir(path.dirname(outputPath), { recursive: true });
    tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "cowork-pptx-generate-"));
    const inputPath = path.join(tempDir, "input.json");
    const scriptPath = path.join(tempDir, "build-presentation.mjs");

    const artifactToolUrl = pathToFileURL(
      path.join(
        runtime.nodeRoot,
        "node_modules",
        "@oai",
        "artifact-tool",
        "dist",
        "artifact_tool.mjs",
      ),
    ).href;

    await fsp.writeFile(
      inputPath,
      JSON.stringify({ outputPath, options, artifactToolUrl }),
      "utf-8",
    );
    await fsp.writeFile(scriptPath, ARTIFACT_TOOL_PPTX_BUILDER, "utf-8");

    await execFileAsync(runtime.nodeBinary, [scriptPath, inputPath], {
      cwd: runtime.nodeRoot,
      timeout: ARTIFACT_TOOL_GENERATION_TIMEOUT_MS,
      maxBuffer: 16 * 1024 * 1024,
    });
  } finally {
    if (tempDir) {
      await fsp.rm(tempDir, { recursive: true, force: true }).catch(() => {
        // Best-effort cleanup.
      });
    }
  }
}

const ARTIFACT_TOOL_PPTX_BUILDER = String.raw`
const fs = await import("node:fs/promises");
const path = await import("node:path");

const inputPath = process.argv[2];
const { outputPath, options, artifactToolUrl } = JSON.parse(await fs.readFile(inputPath, "utf-8"));
const { Presentation, PresentationFile } = await import(artifactToolUrl);

const WIDTH = 1280;
const HEIGHT = 720;
const FONT = {
  title: options.theme?.fontFace || "Aptos Display",
  body: options.theme?.fontFace || "Aptos",
};

function cleanHex(value, fallback) {
  if (typeof value !== "string") return fallback;
  const raw = value.trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{6}$/.test(raw)) return "#" + raw.toUpperCase();
  if (/^[0-9a-fA-F]{3}$/.test(raw)) {
    return "#" + raw.split("").map((c) => c + c).join("").toUpperCase();
  }
  return fallback;
}

const palette = {
  primary: cleanHex(options.theme?.primaryColor, "#2563EB"),
  secondary: cleanHex(options.theme?.secondaryColor, "#0F172A"),
  ink: "#101827",
  body: "#2F3747",
  muted: "#64748B",
  bg: "#F8FAFC",
  paper: "#FFFFFF",
  rule: "#D7DEE8",
  soft: "#E8F0FF",
  warm: "#F97316",
};

function normalizeSlides(slides) {
  if (Array.isArray(slides) && slides.length > 0) return slides;
  return [{ title: options.title || "Presentation", subtitle: options.subject || "", layout: "title" }];
}

function bulletItems(slide) {
  const bullets = Array.isArray(slide.bullets) ? slide.bullets : [];
  const content = typeof slide.content === "string" && slide.content.trim() ? [slide.content.trim()] : [];
  return [...content, ...bullets]
    .map((item) => String(item || "").replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function transparentTextBox(slide, position) {
  return slide.shapes.add({
    geometry: "rect",
    position,
    fill: "#FFFFFF00",
    line: { width: 0, fill: "#FFFFFF00" },
  });
}

function addText(slide, text, position, style = {}) {
  const shape = transparentTextBox(slide, position);
  shape.text = String(text || "");
  shape.text.typeface = style.typeface || FONT.body;
  shape.text.fontSize = style.fontSize || 24;
  shape.text.color = style.color || palette.ink;
  shape.text.bold = Boolean(style.bold);
  shape.text.alignment = style.align || "left";
  shape.text.verticalAlignment = style.valign || "top";
  shape.text.insets = style.insets || { left: 0, right: 0, top: 0, bottom: 0 };
  if (style.autoFit !== false) shape.text.autoFit = "shrinkText";
  return shape;
}

function addRect(slide, position, fill, line = { width: 0, fill }) {
  return slide.shapes.add({ geometry: "rect", position, fill, line });
}

function addRoundRect(slide, position, fill, radius = 9000, line = { width: 0, fill }) {
  return slide.shapes.add({
    geometry: "roundRect",
    position,
    fill,
    line,
    adjustmentList: [{ name: "adj", formula: "val " + radius }],
  });
}

function addSlideNumber(slide, index) {
  addText(slide, String(index + 1).padStart(2, "0"), { left: 1160, top: 42, width: 56, height: 30 }, {
    fontSize: 18,
    color: palette.muted,
    bold: true,
    typeface: FONT.body,
    align: "right",
  });
}

async function readImageBlob(imagePath) {
  const bytes = await fs.readFile(imagePath);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

async function addOptionalImage(slide, slideDef, frame) {
  const image = slideDef.image || {};
  try {
    if (image.path) {
      const imagePath = path.isAbsolute(image.path)
        ? image.path
        : path.resolve(path.dirname(outputPath), image.path);
      const placed = slide.images.add({
        blob: await readImageBlob(imagePath),
        fit: "cover",
        alt: slideDef.title || "Slide image",
      });
      placed.position = frame;
      placed.geometry = "roundRect";
      return true;
    }
    if (image.url) {
      const placed = slide.images.add({ uri: image.url, alt: slideDef.title || "Slide image" });
      placed.position = frame;
      placed.geometry = "roundRect";
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

function setSpeakerNotes(slide, notes) {
  if (typeof notes === "string" && notes.trim()) {
    slide.speakerNotes.setText(notes.trim());
  }
}

function renderCover(presentation, slideDef, index) {
  const slide = presentation.slides.add();
  slide.background.fill = palette.secondary;
  addRect(slide, { left: 0, top: 0, width: WIDTH, height: HEIGHT }, palette.secondary);
  addRect(slide, { left: 0, top: 0, width: 18, height: HEIGHT }, palette.primary);
  addRect(slide, { left: 18, top: 0, width: 5, height: HEIGHT }, palette.warm);
  addRoundRect(slide, { left: 840, top: 78, width: 270, height: 270, rotation: 12 }, "#1D4ED860", 12000);
  addRoundRect(slide, { left: 994, top: 368, width: 220, height: 220, rotation: -10 }, "#F973164D", 12000);
  addText(slide, slideDef.title || options.title || "Presentation", { left: 86, top: 178, width: 850, height: 150 }, {
    typeface: FONT.title,
    fontSize: 58,
    bold: true,
    color: "#FFFFFF",
  });
  if (slideDef.subtitle) {
    addText(slide, slideDef.subtitle, { left: 88, top: 350, width: 790, height: 72 }, {
      fontSize: 26,
      color: "#DDE7F6",
    });
  }
  const items = bulletItems(slideDef).slice(0, 3);
  items.forEach((item, itemIndex) => {
    const y = 486 + itemIndex * 42;
    addRect(slide, { left: 90, top: y + 13, width: 34, height: 3 }, palette.warm);
    addText(slide, item, { left: 142, top: y, width: 720, height: 30 }, {
      fontSize: 19,
      color: "#E7EEF8",
    });
  });
  addText(slide, options.author || "", { left: 88, top: 638, width: 480, height: 26 }, {
    fontSize: 15,
    color: "#93A4BA",
  });
  setSpeakerNotes(slide, slideDef.notes);
}

function renderSection(presentation, slideDef, index) {
  const slide = presentation.slides.add();
  slide.background.fill = palette.bg;
  addRect(slide, { left: 0, top: 0, width: WIDTH, height: HEIGHT }, palette.bg);
  addText(slide, String(index + 1).padStart(2, "0"), { left: 86, top: 88, width: 220, height: 120 }, {
    typeface: FONT.title,
    fontSize: 88,
    bold: true,
    color: palette.primary,
  });
  addRect(slide, { left: 92, top: 240, width: 190, height: 6 }, palette.warm);
  addText(slide, slideDef.title || "Section", { left: 330, top: 135, width: 760, height: 160 }, {
    typeface: FONT.title,
    fontSize: 52,
    bold: true,
    color: palette.ink,
  });
  if (slideDef.subtitle || slideDef.content) {
    addText(slide, slideDef.subtitle || slideDef.content, { left: 332, top: 326, width: 710, height: 78 }, {
      fontSize: 24,
      color: palette.body,
    });
  }
  setSpeakerNotes(slide, slideDef.notes);
}

async function renderContent(presentation, slideDef, index) {
  const slide = presentation.slides.add();
  slide.background.fill = palette.bg;
  addRect(slide, { left: 0, top: 0, width: WIDTH, height: HEIGHT }, palette.bg);
  addRect(slide, { left: 68, top: 62, width: 90, height: 6 }, palette.primary);
  addText(slide, slideDef.title || "Untitled slide", { left: 68, top: 86, width: 880, height: 92 }, {
    typeface: FONT.title,
    fontSize: 38,
    bold: true,
    color: palette.ink,
  });
  addSlideNumber(slide, index);

  const items = bulletItems(slideDef);
  const hasImage = await addOptionalImage(slide, slideDef, { left: 770, top: 190, width: 410, height: 330 });
  const contentLeft = 74;
  const contentTop = 210;
  const contentWidth = hasImage ? 610 : 1040;

  if (slideDef.subtitle && !items.includes(slideDef.subtitle)) {
    addText(slide, slideDef.subtitle, { left: contentLeft, top: 166, width: contentWidth, height: 52 }, {
      fontSize: 21,
      color: palette.body,
    });
  }

  if (items.length === 0) {
    addRoundRect(slide, { left: contentLeft, top: contentTop, width: contentWidth, height: 180 }, palette.paper, 9000, {
      width: 1,
      fill: palette.rule,
    });
    addText(slide, "Add talking points here.", { left: contentLeft + 30, top: contentTop + 62, width: contentWidth - 60, height: 42 }, {
      fontSize: 24,
      color: palette.muted,
    });
  } else if (items.length <= 4) {
    items.forEach((item, itemIndex) => {
      const y = contentTop + itemIndex * 94;
      addRoundRect(slide, { left: contentLeft, top: y, width: 44, height: 44 }, itemIndex === 0 ? palette.primary : palette.soft, 13000);
      addText(slide, String(itemIndex + 1), { left: contentLeft, top: y + 8, width: 44, height: 24 }, {
        fontSize: 17,
        bold: true,
        color: itemIndex === 0 ? "#FFFFFF" : palette.primary,
        align: "center",
      });
      addText(slide, item, { left: contentLeft + 66, top: y - 1, width: contentWidth - 76, height: 62 }, {
        fontSize: itemIndex === 0 ? 25 : 22,
        bold: itemIndex === 0,
        color: itemIndex === 0 ? palette.ink : palette.body,
      });
      if (itemIndex < items.length - 1) {
        addRect(slide, { left: contentLeft + 66, top: y + 72, width: contentWidth - 96, height: 1 }, palette.rule);
      }
    });
  } else {
    const columns = hasImage ? 1 : 2;
    const rowsPerColumn = Math.ceil(items.length / columns);
    const columnWidth = columns === 1 ? contentWidth : (contentWidth - 56) / 2;
    items.forEach((item, itemIndex) => {
      const column = Math.floor(itemIndex / rowsPerColumn);
      const row = itemIndex % rowsPerColumn;
      const x = contentLeft + column * (columnWidth + 56);
      const y = contentTop + row * 66;
      addRect(slide, { left: x, top: y + 10, width: 9, height: 9 }, palette.primary);
      addText(slide, item, { left: x + 24, top: y, width: columnWidth - 24, height: 46 }, {
        fontSize: 19,
        color: palette.body,
      });
    });
  }

  setSpeakerNotes(slide, slideDef.notes);
}

function renderBlank(presentation, slideDef) {
  const slide = presentation.slides.add();
  slide.background.fill = palette.paper;
  if (slideDef.title) {
    addText(slide, slideDef.title, { left: 72, top: 72, width: 920, height: 76 }, {
      typeface: FONT.title,
      fontSize: 40,
      bold: true,
      color: palette.ink,
    });
  }
  setSpeakerNotes(slide, slideDef.notes);
}

const presentation = Presentation.create({ slideSize: { width: WIDTH, height: HEIGHT } });
const slides = normalizeSlides(options.slides);

for (let index = 0; index < slides.length; index += 1) {
  const slideDef = slides[index] || {};
  const layout = slideDef.layout || (index === 0 ? "title" : "content");
  if (layout === "title") {
    renderCover(presentation, slideDef, index);
  } else if (layout === "section") {
    renderSection(presentation, slideDef, index);
  } else if (layout === "blank") {
    renderBlank(presentation, slideDef);
  } else {
    await renderContent(presentation, slideDef, index);
  }
}

const pptx = await PresentationFile.exportPptx(presentation);
await fs.mkdir(path.dirname(outputPath), { recursive: true });
await pptx.save(outputPath);
`;

async function generatePPTXWithPptxGenJs(
  outputPath: string,
  options: PptxOptions,
): Promise<void> {
  const PptxGenJS = (await import("pptxgenjs")).default;
  const pptx = new PptxGenJS();

  const primaryColor = (options.theme?.primaryColor || "#2563eb").replace("#", "");
  const fontFace = options.theme?.fontFace || "Helvetica Neue";

  if (options.title) pptx.title = options.title;
  if (options.author) pptx.author = options.author;
  if (options.subject) pptx.subject = options.subject;
  pptx.layout = "LAYOUT_WIDE";

  for (const slideDef of options.slides) {
    const slide = pptx.addSlide();
    const layout = slideDef.layout || (slideDef.bullets ? "content" : "title");

    if (layout === "title" || layout === "section") {
      slide.background = { color: primaryColor };

      if (slideDef.title) {
        slide.addText(slideDef.title, {
          x: 0.8,
          y: layout === "section" ? 2.0 : 2.5,
          w: "85%",
          fontSize: layout === "section" ? 32 : 40,
          fontFace,
          color: "FFFFFF",
          bold: true,
        });
      }

      if (slideDef.subtitle) {
        slide.addText(slideDef.subtitle, {
          x: 0.8,
          y: layout === "section" ? 3.2 : 4.0,
          w: "85%",
          fontSize: 20,
          fontFace,
          color: "E0E7FF",
        });
      }
    } else if (layout === "content") {
      slide.addShape(pptx.ShapeType.rect, {
        x: 0,
        y: 0,
        w: "100%",
        h: 1.0,
        fill: { color: primaryColor },
      });

      if (slideDef.title) {
        slide.addText(slideDef.title, {
          x: 0.6,
          y: 0.15,
          w: "90%",
          fontSize: 24,
          fontFace,
          color: "FFFFFF",
          bold: true,
        });
      }

      let yPos = 1.4;

      if (slideDef.content) {
        slide.addText(slideDef.content, {
          x: 0.6,
          y: yPos,
          w: "88%",
          fontSize: 16,
          fontFace,
          color: "333333",
          lineSpacingMultiple: 1.3,
        });
        yPos += 1.2;
      }

      if (slideDef.bullets && slideDef.bullets.length > 0) {
        const bulletRows = slideDef.bullets.map((b) => ({
          text: b,
          options: {
            bullet: { type: "bullet" as const },
            fontSize: 16,
            fontFace,
            color: "333333",
            lineSpacingMultiple: 1.4,
          },
        }));

        slide.addText(bulletRows, {
          x: 0.6,
          y: yPos,
          w: "88%",
        });
      }

      if (slideDef.image) {
        const imgOpts: {
          x: number;
          y: number;
          w: number;
          h: number;
          path?: string;
        } = {
          x: 5.5,
          y: 1.5,
          w: slideDef.image.width || 4,
          h: slideDef.image.height || 3,
        };
        if (slideDef.image.path && fs.existsSync(slideDef.image.path)) {
          imgOpts.path = slideDef.image.path;
          slide.addImage(imgOpts);
        }
      }
    }

    if (slideDef.notes) {
      slide.addNotes(slideDef.notes);
    }
  }

  await pptx.writeFile({ fileName: outputPath });
}
