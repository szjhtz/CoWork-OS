import * as fs from "fs/promises";
import * as path from "path";
import { Workspace } from "../../../shared/types";
import { generatePPTX } from "../../utils/document-generators/pptx-generator";

export interface SlideContent {
  title: string;
  content?: string[];
  /** Optional subtitle or body text */
  subtitle?: string;
  /** Optional image path (relative to workspace) */
  imagePath?: string;
  /** Layout type */
  layout?: "title" | "titleContent" | "twoColumn" | "imageOnly" | "blank";
  /** Optional speaker notes */
  notes?: string;
}

export interface PresentationOptions {
  /** Presentation title for metadata */
  title?: string;
  /** Author name */
  author?: string;
  /** Subject */
  subject?: string;
  /** Theme color (hex without #) */
  themeColor?: string;
  /** Slide size: standard (4:3), widescreen (16:9), or custom */
  slideSize?: "standard" | "widescreen";
}

/**
 * PresentationBuilder creates PowerPoint presentations (.pptx) through the
 * shared Codex artifact-tool generator.
 */
export class PresentationBuilder {
  constructor(private workspace: Workspace) {}

  async create(
    outputPath: string,
    slides: SlideContent[],
    options: PresentationOptions = {},
  ): Promise<void> {
    const ext = path.extname(outputPath).toLowerCase();

    if (ext === ".md") {
      await this.createMarkdownSlides(outputPath, slides);
      return;
    }

    await generatePPTX(outputPath, {
      title: options.title,
      author: options.author || "CoWork OS",
      subject: options.subject,
      theme: {
        primaryColor: options.themeColor ? `#${options.themeColor.replace("#", "")}` : undefined,
      },
      slides: slides.map((slide, index) => ({
        title: slide.title,
        subtitle: slide.subtitle,
        content: slide.layout === "imageOnly" ? slide.content?.[0] : undefined,
        bullets: slide.layout === "imageOnly" ? slide.content?.slice(1) : slide.content,
        notes: slide.notes,
        layout:
          slide.layout === "title"
            ? "title"
            : slide.layout === "blank"
              ? "blank"
              : index === 0
                ? "title"
                : "content",
        image: slide.imagePath
          ? {
              path: path.isAbsolute(slide.imagePath)
                ? slide.imagePath
                : path.join(this.workspace.path, slide.imagePath),
            }
          : undefined,
      })),
    });
  }

  /**
   * Creates Markdown slides (fallback)
   */
  private async createMarkdownSlides(outputPath: string, slides: SlideContent[]): Promise<void> {
    const markdown = slides
      .map((slide, index) => {
        const lines: string[] = ["---", `# Slide ${index + 1}: ${slide.title}`, ""];

        if (slide.subtitle) {
          lines.push(`*${slide.subtitle}*`, "");
        }

        if (slide.content && slide.content.length > 0) {
          lines.push(...slide.content.map((item) => `- ${item}`), "");
        }

        if (slide.notes) {
          lines.push("", "> Notes: " + slide.notes, "");
        }

        return lines.join("\n");
      })
      .join("\n");

    await fs.writeFile(outputPath, markdown, "utf-8");
  }
}
