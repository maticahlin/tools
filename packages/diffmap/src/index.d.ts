// Types for @maticahlin/diffmaps

export type Color = string; // '#rrggbb', '#rgb' or 'rgb(r, g, b)'
export type Corner = 'black' | 'red' | 'green' | 'blue' | 'yellow' | 'magenta' | 'cyan' | 'white';

export interface DifferencePalette {
  mode?: 'difference';
  /** What each corner color turns into. Unset corners keep the classic inversion. */
  nodes?: Partial<Record<Corner, Color>>;
  /** Colors that must land exactly: a plain color lands on the node map, {from, to} lands on `to`. */
  anchors?: Array<Color | { from: Color; to: Color }>;
  /** Override the fitted fallback: what black and white turn into on page content. */
  fallback?: { black: Color; white: Color };
}

export interface SwapPalette {
  mode: 'swap';
  /** Two colors that trade places exactly, e.g. a brand color and white. */
  colors: [Color, Color];
}

export interface DuotonePalette {
  mode: 'duotone';
  /** [what dark areas become, what light areas become] */
  stops: [Color, Color];
}

export type Palette = DifferencePalette | SwapPalette | DuotonePalette;

export type Cursor =
  | null
  | { text: string; font?: string; lineHeight?: number; maxWidth?: number; align?: 'left' | 'center' | 'right'; smoothing?: 'antialiased' | 'native' }
  | { image: string; width?: number; height?: number };

export interface DiffmapOptions {
  palette?: Palette;
  /** Named palettes, used inside elements with data-diffmap-palette="name". */
  palettes?: Record<string, Palette>;
  /** Circle diameter in px. Default 36. */
  size?: number;
  /** Grow over links and buttons; false to turn off. */
  grow?: false | { selector?: string; size?: number };
  /** Follow smoothing per frame, 0.05–1 (1 = no lag). Default 0.2. */
  ease?: number;
  /** Images/video that get the full node map. Default 'img[data-diffmap], video[data-diffmap]'; true = all. */
  media?: string | boolean;
  hideCursor?: boolean;
  /** 'auto' picks 'absolute' on Linux WebKit only. */
  position?: 'auto' | 'fixed' | 'absolute';
  /** Circle: px over which the effect fades out at the rim. Default 1.25. */
  edge?: number;
  cursor?: Cursor;
  /** The space this browser blends in. 'auto' = Display P3 on wide-gamut Macs (Safari, Chromium), else sRGB. */
  colorSpace?: 'auto' | 'srgb' | 'display-p3';
  zIndex?: number;
  /** ms to tween between palettes. Default 220. */
  transition?: number;
  /** Run on touch-only devices too (they have no hover). */
  force?: boolean;
}

export interface MediaState {
  el: HTMLImageElement | HTMLVideoElement;
  state: 'loading' | 'working' | 'ready' | 'tainted' | 'skip' | null;
  visible: boolean;
}

export interface DiffmapController {
  /** false on touch-only devices and during server rendering. */
  enabled: boolean;
  setPalette(palette: Palette): void;
  /** Text cursor: change the label. */
  setText(text: string): void;
  /** Pick up images added later (also automatic). */
  refresh(): void;
  inspect(): {
    mode: 'fixed' | 'absolute';
    space: 'srgb' | 'display-p3';
    media: MediaState[];
    perf: { frames: number; avgMs: number; worstMs: number };
  };
  destroy(): void;
}

export function diffmap(options?: DiffmapOptions): DiffmapController;
export default diffmap;

export * from './core.js';
