/**
 * Brand logos sourced via 21st MCP `search_logo` → svgl.app.
 * UI chrome icons are supplied by the Tabler bridge.
 */
import type { ComponentType, SVGProps } from "react";
import { cn } from "@/lib/utils";

export type BrandId =
  | "github"
  | "gitlab"
  | "openai"
  | "anthropic"
  | "google"
  | "gemini"
  | "ollama"
  | "copilot";

type MarkProps = SVGProps<SVGSVGElement> & { title?: string };

/** GitHub — https://svgl.app/library/github_light.svg (monochrome → currentColor) */
function GithubMark(props: MarkProps) {
  return (
    <svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" fill="none" aria-hidden {...props}>
      <path
        fill="currentColor"
        fillRule="evenodd"
        clipRule="evenodd"
        d="M512 0C229.12 0 0 229.12 0 512c0 226.56 146.56 417.92 350.08 485.76 25.6 4.48 35.2-10.88 35.2-24.32 0-12.16-.64-52.48-.64-95.36-128.64 23.68-161.92-31.36-172.16-60.16-5.76-14.72-30.72-60.16-52.48-72.32-17.92-9.6-43.52-33.28-.64-33.92 40.32-.64 69.12 37.12 78.72 52.48 46.08 77.44 119.68 55.68 149.12 42.24 4.48-33.28 17.92-55.68 32.64-68.48-113.92-12.8-232.96-56.96-232.96-252.8 0-55.68 19.84-101.76 52.48-137.6-5.12-12.8-23.04-65.28 5.12-135.68 0 0 42.88-13.44 140.8 52.48 40.96-11.52 84.48-17.28 128-17.28s87.04 5.76 128 17.28c97.92-66.56 140.8-52.48 140.8-52.48 28.16 70.4 10.24 122.88 5.12 135.68 32.64 35.84 52.48 81.28 52.48 137.6 0 196.48-119.68 240-233.6 252.8 18.56 16 34.56 46.72 34.56 94.72 0 68.48-.64 123.52-.64 140.8 0 13.44 9.6 29.44 35.2 24.32C877.44 929.92 1024 737.92 1024 512 1024 229.12 794.88 0 512 0"
      />
    </svg>
  );
}

/** GitLab — https://svgl.app/library/gitlab.svg */
function GitlabMark(props: MarkProps) {
  return (
    <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden {...props}>
      <path
        d="m31.46 12.78-.04-.12-4.35-11.35A1.14 1.14 0 0 0 25.94.6c-.24 0-.47.1-.66.24-.19.15-.33.36-.39.6l-2.94 9h-11.9l-2.94-9A1.14 1.14 0 0 0 6.07.58a1.15 1.15 0 0 0-1.14.72L.58 12.68l-.05.11a8.1 8.1 0 0 0 2.68 9.34l.02.01.04.03 6.63 4.97 3.28 2.48 2 1.52a1.35 1.35 0 0 0 1.62 0l2-1.52 3.28-2.48 6.67-5h.02a8.09 8.09 0 0 0 2.7-9.36Z"
        fill="#E24329"
      />
      <path
        d="m31.46 12.78-.04-.12a14.75 14.75 0 0 0-5.86 2.64l-9.55 7.24 6.09 4.6 6.67-5h.02a8.09 8.09 0 0 0 2.67-9.36Z"
        fill="#FC6D26"
      />
      <path
        d="m9.9 27.14 3.28 2.48 2 1.52a1.35 1.35 0 0 0 1.62 0l2-1.52 3.28-2.48-6.1-4.6-6.07 4.6Z"
        fill="#FCA326"
      />
      <path
        d="M6.44 15.3a14.71 14.71 0 0 0-5.86-2.63l-.05.12a8.1 8.1 0 0 0 2.68 9.34l.02.01.04.03 6.63 4.97 6.1-4.6-9.56-7.24Z"
        fill="#FC6D26"
      />
    </svg>
  );
}

/** OpenAI — https://svgl.app/library/openai.svg */
function OpenaiMark(props: MarkProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 256 260"
      preserveAspectRatio="xMidYMid"
      aria-hidden
      {...props}
    >
      <path
        fill="currentColor"
        d="M239.184 106.203a64.716 64.716 0 0 0-5.576-53.103C219.452 28.459 191 15.784 163.213 21.74A65.586 65.586 0 0 0 52.096 45.22a64.716 64.716 0 0 0-43.23 31.36c-14.31 24.602-11.061 55.634 8.033 76.74a64.665 64.665 0 0 0 5.525 53.102c14.174 24.65 42.644 37.324 70.446 31.36a64.72 64.72 0 0 0 48.754 21.744c28.481.025 53.714-18.361 62.414-45.481a64.767 64.767 0 0 0 43.229-31.36c14.137-24.558 10.875-55.423-8.083-76.483Zm-97.56 136.338a48.397 48.397 0 0 1-31.105-11.255l1.535-.87 51.67-29.825a8.595 8.595 0 0 0 4.247-7.367v-72.85l21.845 12.636c.218.111.37.32.409.563v60.367c-.056 26.818-21.783 48.545-48.601 48.601Zm-104.466-44.61a48.345 48.345 0 0 1-5.781-32.589l1.534.921 51.722 29.826a8.339 8.339 0 0 0 8.441 0l63.181-36.425v25.221a.87.87 0 0 1-.358.665l-52.335 30.184c-23.257 13.398-52.97 5.431-66.404-17.803ZM23.549 85.38a48.499 48.499 0 0 1 25.58-21.333v61.39a8.288 8.288 0 0 0 4.195 7.316l62.874 36.272-21.845 12.636a.819.819 0 0 1-.767 0L41.353 151.53c-23.211-13.454-31.171-43.144-17.804-66.405v.256Zm179.466 41.695-63.08-36.63L161.73 77.86a.819.819 0 0 1 .768 0l52.233 30.184a48.6 48.6 0 0 1-7.316 87.635v-61.391a8.544 8.544 0 0 0-4.4-7.213Zm21.742-32.69-1.535-.922-51.619-30.081a8.39 8.39 0 0 0-8.492 0L99.98 99.808V74.587a.716.716 0 0 1 .307-.665l52.233-30.133a48.652 48.652 0 0 1 72.236 50.391v.205ZM88.061 139.097l-21.845-12.585a.87.87 0 0 1-.41-.614V65.685a48.652 48.652 0 0 1 79.757-37.346l-1.535.87-51.67 29.825a8.595 8.595 0 0 0-4.246 7.367l-.051 72.697Zm11.868-25.58 28.138-16.217 28.188 16.218v32.434l-28.086 16.218-28.188-16.218-.052-32.434Z"
      />
    </svg>
  );
}

/** Asset-backed marks (multi-path / colored) from 21st → svgl downloads */
function AssetMark({ src, className }: { src: string; className?: string }) {
  return <img src={src} alt="" className={cn("object-contain", className)} draggable={false} />;
}

const anthropicUrl = new URL("../../assets/brand/anthropic.svg", import.meta.url).href;
const googleUrl = new URL("../../assets/brand/google.svg", import.meta.url).href;
const geminiUrl = new URL("../../assets/brand/gemini.svg", import.meta.url).href;
const ollamaUrl = new URL("../../assets/brand/ollama.svg", import.meta.url).href;
const copilotUrl = new URL("../../assets/brand/copilot.svg", import.meta.url).href;

const SVG_MARKS: Partial<Record<BrandId, ComponentType<MarkProps>>> = {
  github: GithubMark,
  gitlab: GitlabMark,
  openai: OpenaiMark,
};

interface BrandLogoProps {
  brand: BrandId;
  className?: string;
  title?: string;
}

export function BrandLogo({ brand, className, title }: BrandLogoProps) {
  const Svg = SVG_MARKS[brand];
  if (Svg) {
    return <Svg className={cn("shrink-0", className)} title={title} />;
  }

  const src =
    brand === "anthropic"
      ? anthropicUrl
      : brand === "google"
        ? googleUrl
        : brand === "gemini"
          ? geminiUrl
          : brand === "ollama"
            ? ollamaUrl
            : copilotUrl;

  return (
    <span className={cn("inline-flex shrink-0", className)} title={title}>
      <AssetMark src={src} className="h-full w-full" />
    </span>
  );
}
