// Types for @maticahlin/diffmaps/core — the color math, no DOM.
import type { Palette, Color, Corner } from './index.js';

export type RGB = [number, number, number] | number[];
export interface Fallback { a: number[]; d: number[]; A: number[]; B: number[]; exact?: boolean[]; error?: number }
export interface Layer { blend: string; color: string }
export interface Resolved {
  nodes: Record<Corner, number[]>;
  fallback: Fallback;
  duotone: boolean;
  media: boolean;
  space: 'srgb' | 'display-p3';
  kind: 'affine' | 'clamped';
  layers: Layer[];
  /** What a page color (sRGB) turns into under the blend layers, in sRGB. */
  page(c: RGB): number[];
  toSpace(c: RGB): number[];
  fromSpace(c: RGB): number[];
}

export const CORNERS: Corner[];
export const CORNER_RGB: Record<Corner, number[]>;
export const PRESETS: Record<'classic' | 'ultramarine' | 'riso' | 'ember', Partial<Record<Corner, Color>>>;
export const AFFINE: string[];
export const CLAMPED: string[];

export function resolvePalette(palette?: Palette, options?: { space?: 'srgb' | 'display-p3' }): Resolved;
export function parseColor(input: Color | RGB): number[];
export function toHex(rgb: RGB): string;
export function clamp01(v: number): number;
export function invertNodes(): Record<Corner, string>;
export function normalizeNodes(nodes?: Partial<Record<Corner, Color>>): Record<Corner, number[]>;
export function fitToRange(nodes: Partial<Record<Corner, Color>>): Record<Corner, string>;
export function lookup(nodes: Record<Corner, number[]>, c: RGB): number[];
export function fitFallback(nodes: Record<Corner, number[]>, anchors?: Array<Color | { from: Color; to: Color }>, options?: { cornerWeight?: number; space?: 'srgb' | 'display-p3' }): Fallback;
export function applyFallback(fb: Fallback | { a: number[]; d: number[] }, c: RGB): number[];
export function precorrect(fb: Fallback | { a: number[]; d: number[] }, target: RGB, out?: number[]): number[];
export function coverage(fb: Fallback, nodes: Record<Corner, number[]>): number;
export function kindOf(fb: Fallback | { a: number[]; d: number[] }): 'affine' | 'clamped';
export function makeFallback(a: number[], d: number[], extra?: object): Fallback;
export function layers(fb: Fallback, options?: { duotone?: boolean; space?: 'srgb' | 'display-p3' }): Layer[];
export function layersAt(fb: Fallback | { a: number[]; d: number[] }, t?: number, kind?: 'affine' | 'clamped'): number[][];
export function rampBreaks(fb: Fallback, kind?: 'affine' | 'clamped'): number[];
export function edgeStops(fb: Fallback, kind?: 'affine' | 'clamped'): Array<{ t: number; at: number }>;
export function activeLayers(fb: Fallback, kind?: 'affine' | 'clamped'): number[];
export function srgbToP3(c: RGB): number[];
export function p3ToSrgb(c: RGB): number[];
export function spaceOf(space?: 'srgb' | 'display-p3'): { name: string; to(c: RGB): number[]; from(c: RGB): number[] };
export function cssColor(c: RGB, space?: 'srgb' | 'display-p3'): string;
export function detectSpace(env?: object): 'srgb' | 'display-p3';
export function recolorParams(resolved: Resolved): { n: number[]; a: number[]; d: number[]; p3: number[] | null };
export function recolorPixels(px: Uint8ClampedArray, params: { n: number[]; a: number[]; d: number[]; p3: number[] | null }): Uint8ClampedArray;
