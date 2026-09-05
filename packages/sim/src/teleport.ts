/**
 * Teleports.
 *
 * Het origineel beheert per teleport een cooldown en een "wie kwam hier net vandaan"
 * (src/lifish/level/TeleportSystem.cpp). Dat is nodig omdat twee teleports elkaar anders
 * eindeloos heen en weer voeden. Wij bereiken hetzelfde met een cooldown op de reiziger:
 * simpeler, en het gedrag dat je ziet is gelijk.
 */

import { TILE_SIZE, TELEPORT_COOLDOWN } from './constants.js';
import { entityTile } from './grid.js';
import { emit, sound } from './events.js';
import type { Entity, World } from './types.js';

/** Hoe dicht op het midden van de tegel je moet staan om te warpen. */
const ALIGN_TOLERANCE = 4;

export function teleportStep(w: World, e: Entity, dt: number): void {
	if (e.teleportCd !== undefined && e.teleportCd > 0) {
		e.teleportCd = Math.max(0, e.teleportCd - dt);
		return;
	}

	const dx = Math.abs(e.x - Math.round(e.x / TILE_SIZE) * TILE_SIZE);
	const dy = Math.abs(e.y - Math.round(e.y / TILE_SIZE) * TILE_SIZE);
	if (dx + dy >= ALIGN_TOLERANCE) return;

	const { tx, ty } = entityTile(e);

	const teleports = w.entities.filter((t) => t.kind === 'teleport' && !t.dead);
	if (teleports.length < 2) return;

	const idx = teleports.findIndex((t) => t.tx === tx && t.ty === ty);
	if (idx < 0) return;

	// Naar de volgende teleport in de lijst; de lijstvolgorde is de tilemap-volgorde, wat
	// overeenkomt met hoe LevelLoader ze registreert.
	const dest = teleports[(idx + 1) % teleports.length]!;
	e.x = dest.x;
	e.y = dest.y;
	e.teleportCd = TELEPORT_COOLDOWN;
	e.justWarped = true;

	sound(w, 'teleport.ogg');
	emit(w, { t: 'fx', name: 'flash', x: dest.x, y: dest.y });
}

/** Wordt aan het eind van de tick gewist; de AI gebruikt het één frame lang. */
export function clearWarpFlags(w: World): void {
	for (const e of w.entities) if (e.justWarped) e.justWarped = false;
}
