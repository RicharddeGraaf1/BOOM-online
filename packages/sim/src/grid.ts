/**
 * Rasterhulp. Tegelcoördinaten lopen van 1..width en 1..height; 0 en width+1 zijn de border.
 * Pixel (32,32) is dus tegel (1,1). Transcriptie van src/core/utils.hpp.
 */

import { TILE_SIZE } from './constants.js';
import type { Entity, World } from './types.js';

export function tileOf(px: number): number {
	return Math.floor(px / TILE_SIZE);
}

export function alignedPx(px: number): number {
	return Math.floor(px / TILE_SIZE) * TILE_SIZE;
}

/** De tegel waar het midden van een 32x32-entity in ligt. */
export function centerTile(v: number): number {
	return Math.floor((v + TILE_SIZE / 2) / TILE_SIZE);
}

export function gridIndex(w: World, tx: number, ty: number): number {
	return ty * (w.width + 2) + tx;
}

export function inBounds(w: World, tx: number, ty: number): boolean {
	return tx >= 1 && ty >= 1 && tx <= w.width && ty <= w.height;
}

/** Muur of border: blokkeert beweging én explosies. */
export function isWall(w: World, tx: number, ty: number): boolean {
	if (!inBounds(w, tx, ty)) return true;
	const i = gridIndex(w, tx, ty);
	return w.fixed[i] === 1 || w.breakable[i] === 1;
}

export function isFixed(w: World, tx: number, ty: number): boolean {
	if (!inBounds(w, tx, ty)) return true;
	return w.fixed[gridIndex(w, tx, ty)] === 1;
}

export function isBreakable(w: World, tx: number, ty: number): boolean {
	if (!inBounds(w, tx, ty)) return false;
	return w.breakable[gridIndex(w, tx, ty)] === 1;
}

/** Ligt de entity binnen een halve pixel van het raster? */
export function isAligned(e: Entity): boolean {
	return isAlignedX(e) && isAlignedY(e);
}

export function isAlignedX(e: Entity): boolean {
	return Math.abs(e.x - Math.round(e.x / TILE_SIZE) * TILE_SIZE) < 0.5;
}

export function isAlignedY(e: Entity): boolean {
	return Math.abs(e.y - Math.round(e.y / TILE_SIZE) * TILE_SIZE) < 0.5;
}

export function snapToGrid(e: Entity): void {
	e.x = Math.round(e.x / TILE_SIZE) * TILE_SIZE;
	e.y = Math.round(e.y / TILE_SIZE) * TILE_SIZE;
}

/** De tegel waarop een entity staat, afgerond naar de dichtstbijzijnde. */
export function entityTile(e: Entity): { tx: number; ty: number } {
	return {
		tx: Math.round(e.x / TILE_SIZE),
		ty: Math.round(e.y / TILE_SIZE),
	};
}

export function manhattan(ax: number, ay: number, bx: number, by: number): number {
	return Math.abs(ax - bx) + Math.abs(ay - by);
}
