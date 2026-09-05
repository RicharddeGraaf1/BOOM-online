/**
 * Gebeurtenissen en score. Apart gehouden van world.ts zodat de systemen hier op kunnen
 * leunen zonder dat er een importcyclus met de wereld-update ontstaat.
 */

import { bonus as BONUS } from './constants.js';
import type { GameEvent, World } from './types.js';

export const SCORE = {
	COIN: 150,
	LETTER: 100,
	BREAKABLE: 10,
	BONUS: BONUS.VALUE,
	ALIEN_BOSS: 5000,
	BIG_ALIEN_BOSS: 10000,
	/** een vijand is waard: id * 100. src/lifish/entities/Enemy.cpp:73 */
	enemy: (id: number) => id * 100,
} as const;

export function emit(w: World, ev: GameEvent): void {
	w.events.push(ev);
}

export function sound(w: World, name: string): void {
	w.events.push({ t: 'sound', name });
}

export function addScore(w: World, playerId: number, value: number, x: number, y: number): void {
	const ps = w.players[playerId - 1];
	if (ps) ps.score += value;
	w.events.push({ t: 'points', value, x, y });
}

export function addScoreToAll(w: World, value: number, x: number, y: number): void {
	for (const ps of w.players) ps.score += value;
	w.events.push({ t: 'points', value, x, y });
}
