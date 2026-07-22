/**
 * Design tokens shared by every rendering surface-ui produces (HTML
 * components today; console + wizard later — see docs/host-ui-plan.md §2,
 * §5). Kept small and tasteful: a warm-dark accent, not a purple gradient.
 *
 * Consumers should treat this as data, not CSS — turn it into CSS variables,
 * inline styles, or a design-system mapping as needed. `theme.ts` itself
 * has zero DOM/CSS dependencies so it can be imported anywhere (Node,
 * browser, or a template string).
 */

export interface ColorScale {
  background: string;
  surface: string;
  border: string;
  text: string;
  textMuted: string;
  accent: string;
  accentText: string;
  danger: string;
  success: string;
}

export interface Theme {
  light: ColorScale;
  dark: ColorScale;
  spacing: Record<"xs" | "sm" | "md" | "lg" | "xl", string>;
  radius: Record<"sm" | "md" | "lg", string>;
  font: {
    sans: string;
    mono: string;
  };
}

export const theme: Theme = {
  light: {
    background: "#fffdf9",
    surface: "#ffffff",
    border: "#e7e0d6",
    text: "#211c16",
    textMuted: "#6b6255",
    accent: "#b5502e",
    accentText: "#ffffff",
    danger: "#a13a2d",
    success: "#3f7a4f",
  },
  dark: {
    background: "#17140f",
    surface: "#211c16",
    border: "#3a3226",
    text: "#f2ece2",
    textMuted: "#a89c88",
    accent: "#e08a5c",
    accentText: "#211c16",
    danger: "#e5776a",
    success: "#7ec98f",
  },
  spacing: {
    xs: "4px",
    sm: "8px",
    md: "12px",
    lg: "20px",
    xl: "32px",
  },
  radius: {
    sm: "4px",
    md: "8px",
    lg: "14px",
  },
  font: {
    sans:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    mono:
      'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
  },
};
