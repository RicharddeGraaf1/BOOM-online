/**
 * Beweging over het raster.
 *
 * Het origineel (src/core/components/AxisMoving.cpp) beweegt langs één as tegelijk en
 * "hertelt" de entity op het raster zodra hij tegen iets aan loopt. De regel die het
 * speelgevoel maakt: je mag pas van as wisselen als je op de andere as uitgelijnd bent —
 * behalve omkeren, dat mag altijd (fast turn).
 */

import { TILE_SIZE } from './constants.js';
import { Dir, isVertical, opposite, versor, type Direction } from './direction.js';
import { isAlignedX, isAlignedY, isWall } from './grid.js';
import type { Entity, World } from './types.js';

/** Tolerantie waarbinnen we een entity als uitgelijnd beschouwen. */
const ALIGN_EPS = 1.5;

/** Kan deze entity vanuit zijn huidige tegel die kant op? Transcriptie van LevelManager::canGo. */
export function canGo(w: World, e: Entity, dir: Direction, blockers?: Uint8Array): boolean {
	if (dir === Dir.NONE) return true;
	const [dx, dy] = versor(dir);
	const tx = Math.round(e.x / TILE_SIZE) + dx;
	const ty = Math.round(e.y / TILE_SIZE) + dy;
	if (isWall(w, tx, ty)) return false;
	if (blockers && blockers[ty * (w.width + 2) + tx] === 1) return false;
	return true;
}

function alignAxis(e: Entity, vertical: boolean): void {
	if (vertical) e.x = Math.round(e.x / TILE_SIZE) * TILE_SIZE;
	else e.y = Math.round(e.y / TILE_SIZE) * TILE_SIZE;
}

/**
 * Probeert van richting te wisselen. Lukt alleen als de entity uitgelijnd staat op de as
 * waar hij vanaf wil, of als het een omkering is.
 */
export function trySetDirection(e: Entity, dir: Direction): boolean {
	if (dir === e.dir) return true;
	if (dir === Dir.NONE) {
		e.dir = Dir.NONE;
		e.moving = false;
		return true;
	}
	if (dir === opposite(e.dir)) {
		e.dir = dir;
		e.facing = dir;
		e.moving = true;
		e.distTravelled = 0;
		return true;
	}
	const perpendicularAligned = isVertical(dir) ? isAlignedX(e) : isAlignedY(e);
	if (!perpendicularAligned && e.dir !== Dir.NONE) return false;

	alignAxis(e, isVertical(dir));
	e.dir = dir;
	e.facing = dir;
	e.moving = true;
	e.distTravelled = 0;
	return true;
}

export interface MoveResult {
	/** de entity botste deze tick tegen een muur */
	blocked: boolean;
	/** afgelegde afstand deze tick */
	moved: number;
}

/**
 * Verplaatst een entity één tick. Blokkeert op muren en klemt netjes op de tegelgrens,
 * zodat een entity nooit half in een muur eindigt.
 */
export function moveEntity(w: World, e: Entity, dt: number, blockers?: Uint8Array): MoveResult {
	if (e.blockedT > 0) {
		e.blockedT -= dt;
		return { blocked: false, moved: 0 };
	}
	if (!e.moving || e.dir === Dir.NONE) return { blocked: false, moved: 0 };

	const effSpeed = e.speed * (1 + e.dash);
	let delta = effSpeed * dt;
	if (delta <= 0) return { blocked: false, moved: 0 };

	const [dx, dy] = versor(e.dir);
	const vertical = isVertical(e.dir);

	// Uitlijnen op de dwarse as terwijl we bewegen: zonder dit "glijdt" een entity die net
	// van richting wisselde langzaam uit het raster.
	alignAxis(e, vertical);

	const cur = vertical ? e.y : e.x;
	const step = vertical ? dy : dx;
	const curTile = Math.round(cur / TILE_SIZE);
	const nextTile = curTile + step;

	const nx = vertical ? Math.round(e.x / TILE_SIZE) : nextTile;
	const ny = vertical ? nextTile : Math.round(e.y / TILE_SIZE);

	const blockedAhead =
		isWall(w, nx, ny) || (blockers !== undefined && blockers[ny * (w.width + 2) + nx] === 1);

	if (blockedAhead) {
		// Doorlopen tot precies de rand van de eigen tegel, dan stoppen.
		const limit = curTile * TILE_SIZE;
		const remaining = (limit - cur) * step;
		if (remaining <= ALIGN_EPS) {
			if (vertical) e.y = limit;
			else e.x = limit;
			return { blocked: true, moved: 0 };
		}
		delta = Math.min(delta, remaining);
	}

	if (vertical) e.y += step * delta;
	else e.x += step * delta;

	e.distTravelled += delta;
	return { blocked: false, moved: delta };
}

/** Staat de entity binnen de tolerantie op een tegelmiddelpunt? */
export function nearGrid(e: Entity): boolean {
	const rx = Math.abs(e.x - Math.round(e.x / TILE_SIZE) * TILE_SIZE);
	const ry = Math.abs(e.y - Math.round(e.y / TILE_SIZE) * TILE_SIZE);
	return rx < ALIGN_EPS && ry < ALIGN_EPS;
}
