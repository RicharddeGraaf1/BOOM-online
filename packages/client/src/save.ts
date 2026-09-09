/**
 * Opgeslagen spel.
 *
 * Het origineel schrijft een `.lifish`-bestand (SaveManager); in de browser is localStorage
 * het equivalent. Er wordt bij elke levelwissel automatisch opgeslagen — een spel van tachtig
 * levels waarin je zelf aan opslaan moet denken, is een spel dat je kwijtraakt.
 *
 * Alleen voor lokaal spelen: online houdt de server de stand bij.
 */

import type { PlayerState } from '@boom/sim';

const KEY = 'boom-online:save';
const VERSION = 1;

export interface SavedGame {
	version: number;
	/** wanneer er voor het laatst opgeslagen is */
	at: string;
	levelNum: number;
	nPlayers: number;
	players: PlayerState[];
}

export function saveGame(levelNum: number, nPlayers: number, players: PlayerState[]): void {
	const data: SavedGame = {
		version: VERSION,
		at: new Date().toISOString(),
		levelNum,
		nPlayers,
		// Structured clone, anders schrijven we een verwijzing naar levende spelstaat weg.
		players: players.map((p) => ({ ...p, letters: [...p.letters] as PlayerState['letters'] })),
	};
	try {
		localStorage.setItem(KEY, JSON.stringify(data));
	} catch {
		// Privémodus of volle opslag: dan bewaren we het gewoon niet.
	}
}

export function loadGame(): SavedGame | null {
	try {
		const raw = localStorage.getItem(KEY);
		if (!raw) return null;

		const data = JSON.parse(raw) as Partial<SavedGame>;
		// Een opslag uit een oudere versie is niet te vertrouwen; liever niets dan iets kapots.
		if (data.version !== VERSION) return null;
		if (typeof data.levelNum !== 'number' || !Array.isArray(data.players)) return null;

		return data as SavedGame;
	} catch {
		return null;
	}
}

export function clearSave(): void {
	try {
		localStorage.removeItem(KEY);
	} catch {
		// Niets aan te doen, en niets aan verloren.
	}
}

/** Korte omschrijving voor op de knop. */
export function describeSave(save: SavedGame): string {
	const score = save.players
		.filter((p) => p.present)
		.reduce((sum, p) => sum + p.score, 0);
	const when = new Date(save.at);
	const stamp = Number.isNaN(when.getTime())
		? ''
		: ` · ${when.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' })}`;
	return `Level ${save.levelNum} · ${score} punten${stamp}`;
}
