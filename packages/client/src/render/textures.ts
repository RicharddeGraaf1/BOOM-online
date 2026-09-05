/**
 * Laden en opdelen van de originele sprite-sheets.
 *
 * De PNG's gaan ongewijzigd mee — ze zijn al pixel-perfect. Het enige wat telt is dat ze
 * nergens onderweg gefilterd worden.
 */

import { Assets, Rectangle, Texture, TextureSource } from 'pixi.js';
import { TILE_SIZE } from '@boom/sim';

/**
 * Globale default: geen bilineaire filtering. Moet gezet zijn vóór de eerste `Assets.load`,
 * anders krijgt die texture alsnog 'linear'.
 */
export function useNearestNeighbour(): void {
	TextureSource.defaultOptions.scaleMode = 'nearest';
}

const GRAPHICS = 'assets/graphics';

export interface SheetSizes {
	[file: string]: { w: number; h: number };
}

/** Het manifest dat `npm run assets:import` schrijft. */
export interface AssetManifest {
	importedFrom: string;
	importedAt: string;
	levels: number;
	sheets: SheetSizes;
}

export async function loadManifest(): Promise<AssetManifest> {
	const res = await fetch('assets/manifest.json');
	if (!res.ok)
		throw new Error(
			'assets/manifest.json ontbreekt. Draai eerst `npm run assets:import` in de repo-root.',
		);
	return (await res.json()) as AssetManifest;
}

export async function loadSheet(file: string): Promise<Texture> {
	const texture = await Assets.load<Texture>(`${GRAPHICS}/${file}`);
	// Vangnet voor het geval useNearestNeighbour() te laat kwam.
	texture.source.scaleMode = 'nearest';
	return texture;
}

/** Eén frame uit een sheet, in pixels. */
export function frame(sheet: Texture, x: number, y: number, w: number, h: number): Texture {
	return new Texture({ source: sheet.source, frame: new Rectangle(x, y, w, h) });
}

/**
 * Eén tegel (32x32) uit een sheet, geïndexeerd op kolom en rij.
 * De sheets liggen strak op het 32px-raster: fixed.png is 8x1, breakable.png 4x8,
 * bonuses.png 9x1, enemy*.png 8x3, player*.png 8x5.
 */
export function tile(sheet: Texture, col: number, row = 0): Texture {
	return frame(sheet, col * TILE_SIZE, row * TILE_SIZE, TILE_SIZE, TILE_SIZE);
}
