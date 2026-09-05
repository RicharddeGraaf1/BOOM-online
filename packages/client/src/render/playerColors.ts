/**
 * Kleuren per speler.
 *
 * Er zijn maar twee spelerssheets in de assets: player1.png (groen) en player2.png (blauw).
 * Speler 3 en 4 lenen die sheets en krijgen een tint mee. Dat is geen luiheid maar de enige
 * schone route — nieuwe sprites tekenen zou betekenen dat we art toevoegen aan een set die
 * niet van ons is, en het verschil moet vooral leesbaar zijn, niet mooi.
 *
 * De tinten liggen in het kleurbereik van BOOM zelf: veelvouden van 0x33, want de originele
 * assets komen uit het 256-kleurenpalet van een Mac uit 1997.
 */

export const PLAYER_TINTS: readonly number[] = [
	0xffffff, // speler 1: player1.png ongewijzigd
	0xffffff, // speler 2: player2.png ongewijzigd
	0xffcc66, // speler 3: player1.png, warm goud
	0xff99cc, // speler 4: player2.png, roze
];

/** Welke sheet een speler gebruikt: 3 en 4 lenen die van 1 en 2. */
export function playerSheet(playerId: number): 1 | 2 {
	return ((playerId - 1) % 2 === 0 ? 1 : 2) as 1 | 2;
}

export function playerTint(playerId: number): number {
	return PLAYER_TINTS[playerId - 1] ?? 0xffffff;
}
