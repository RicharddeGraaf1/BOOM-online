/**
 * Welke sprite-sheets een wereld nodig heeft.
 *
 * Bewust een los, Pixi-vrij bestand: hierdoor is de lijst te controleren zonder GPU of DOM,
 * en dat is precies wat er nodig was. GameView.get() gooit namelijk als een sheet ontbreekt,
 * die uitzondering breekt de ticker af, en Pixi's render hangt als volgende luisteraar aan
 * diezelfde ticker. Eén vergeten sheet levert dus geen foutmelding op maar een zwart scherm.
 */

import type { World } from '@boom/sim';

/** Sheets die in elk level nodig zijn. */
export const CORE_SHEETS: readonly string[] = [
	'player1.png',
	'player2.png',
	'bomb.png',
	'explosionC.png',
	'explosionH.png',
	'explosionV.png',
	'bonuses.png',
	'coin.png',
	'teleport.png',
	'fixed.png',
	'breakable.png',
	'flash.png',
	'aliensprite.png',
	'extra_letters.png',
	'panel.png',
	'playerheads.png',
	'health.png',
	'bonus_icons.png',
	'extra_icons.png',
	'hurryup.png',
	'gameover.png',
	'extragame.png',
];

/** De vaste sheets plus alles wat dit specifieke level nodig heeft. */
export function sheetsNeededFor(w: World): string[] {
	const needed = new Set<string>(CORE_SHEETS);

	needed.add(`bg${w.tileIDs.bg}.png`);
	needed.add(`border${w.tileIDs.border}.png`);

	for (const e of w.entities) {
		if (e.kind === 'enemy') needed.add(`enemy${e.enemyId}.png`);
		if (e.kind === 'boss')
			needed.add(e.bossKind === 'alien' ? 'alien_boss.png' : 'big_alien_boss.png');
	}

	return [...needed];
}
