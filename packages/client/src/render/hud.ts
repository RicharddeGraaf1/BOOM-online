/**
 * Het zijpaneel: score, tijd, levens, gezondheid, bommen en bonussen.
 *
 * Het origineel tekent dit met losse sprites uit panel.png, playerheads.png en
 * bonus_icons.png (src/ui/SidePanel.cpp), voor twee spelers. Wij hebben er maximaal vier, en
 * 96 pixels breed blijft 96 pixels breed — vandaar dat de gezondheid hier een balkje is in
 * plaats van acht hartjes: acht sprites van 17 pixels passen simpelweg niet naast elkaar.
 */

import { Container, Sprite, Text, TextStyle, Texture } from 'pixi.js';
import {
	MAX_PLAYERS,
	bonus as BONUS,
	defaultPowers,
	player as PLAYER,
	type World,
} from '@boom/sim';
import { PLAYER_TINTS } from './playerColors.js';
import type { Sheets } from './sheets.js';

const FONT = 'BoomPanel';
/** Waar een speler mee begint; alles daarboven is een opgeraapte upgrade. */
const DEFAULTS = defaultPowers();
/**
 * panel.png heeft zijn eigen art: het BOOM-logo bovenaan en het Factor Software-logo
 * onderaan. Daar mag niets overheen, dus alle tekst begint onder het logo en de blokken
 * stoppen ruim voor de onderkant.
 */
const HEADER_TOP = 62;
const BLOCK_TOP = 90;
const BLOCK_HEIGHT = 86;
/** Bij één of twee spelers is er ruimte zat; dan mogen de blokken uit elkaar staan. */
const BLOCK_HEIGHT_ROOMY = 170;

/** health.png: drie vakjes van 17x18. Frame 0 is leeg, 1 half, 2 vol (SidePanel.hpp:71-73). */
const HEART_W = 17;
const HEART_H = 18;
const HEARTS = 8;
const HEART_EMPTY = 0;
const HEART_HALF = 1;
const HEART_FULL = 2;
/** extra_icons.png: zes vakjes van 14x15. */
const EXTRA_W = 14;
const EXTRA_H = 15;

/** De originele bitmapfont, zodat de cijfers precies zo staan als in het spel. */
export async function loadPanelFont(): Promise<void> {
	try {
		const face = new FontFace(FONT, 'url(assets/fonts/pf_tempesta_seven_bold.ttf)');
		await face.load();
		document.fonts.add(face);
	} catch {
		// Zonder de font valt Pixi terug op monospace; leesbaar genoeg om door te spelen.
	}
}

function label(size = 8, color = 0xffffff): Text {
	return new Text({
		text: '',
		style: new TextStyle({ fontFamily: [FONT, 'monospace'], fontSize: size, fill: color }),
	});
}

interface PlayerBlock {
	root: Container;
	name: Text;
	score: Text;
	lives: Text;
	bombs: Text;
	/** Acht hartjes in twee rijen van vier, zoals SidePanel::_drawHealth. */
	hearts: Sprite[];
	icons: Sprite[];
	/** Aantal onder het icoon, voor de upgrades die een niveau hebben. */
	counts: Text[];
	/** Icoontjes plus de EXTRA-letters; die passen alleen als er ruimte is. */
	extras: Container;
	letters: Sprite[];
}

export class Hud {
	readonly root = new Container();

	private readonly sheets: Sheets;
	private readonly blocks: PlayerBlock[] = [];
	private bg: Sprite | null = null;
	private healthSheet: Texture | null = null;
	private extraSheet: Texture | null = null;
	private levelText = label(8, 0xffcc00);
	private timeText = label(10, 0xffffff);
	private statusText = label(8, 0xff6a3d);

	constructor(sheets: Sheets) {
		this.sheets = sheets;
	}

	async build(): Promise<void> {
		const panel = await this.sheets.sheet('panel.png');
		const heads = await this.sheets.sheet('playerheads.png');
		const icons = await this.sheets.sheet('bonus_icons.png');
		const health = await this.sheets.sheet('health.png');
		const extraIcons = await this.sheets.sheet('extra_icons.png');
		this.healthSheet = health;
		this.extraSheet = extraIcons;

		this.bg = new Sprite(panel);
		this.bg.scale.set(1 / this.sheets.textureScale);
		this.root.addChild(this.bg);

		this.levelText.position.set(6, HEADER_TOP);
		this.timeText.position.set(50, HEADER_TOP - 2);
		this.statusText.position.set(6, HEADER_TOP + 14);
		this.root.addChild(this.levelText, this.timeText, this.statusText);

		for (let i = 0; i < MAX_PLAYERS; ++i) {
			const block = this.makeBlock(heads, icons, health, extraIcons, i);
			block.root.position.set(0, BLOCK_TOP + i * BLOCK_HEIGHT);
			this.root.addChild(block.root);
			this.blocks.push(block);
		}
	}

	private makeBlock(
		heads: Texture,
		icons: Texture,
		health: Texture,
		extraIcons: Texture,
		index: number,
	): PlayerBlock {
		const root = new Container();

		// Er zijn maar twee koppen in playerheads.png; speler 3 en 4 lenen ze en krijgen
		// hun eigen kleur mee, net als hun poppetje in het speelveld.
		const head = new Sprite(this.sheets.frame(heads, (index % 2) * 32, 0, 32, 21));
		head.scale.set(1 / this.sheets.textureScale);
		head.position.set(4, 0);
		head.tint = PLAYER_TINTS[index] ?? 0xffffff;
		root.addChild(head);

		const name = label(8, PLAYER_TINTS[index] ?? 0xffffff);
		name.text = `P${index + 1}`;
		name.position.set(40, 4);
		root.addChild(name);

		const score = label(8, 0xffffff);
		score.position.set(4, 23);
		root.addChild(score);

		const lives = label(8, 0xcccccc);
		lives.position.set(4, 35);
		root.addChild(lives);

		const bombs = label(8, 0xffcc00);
		bombs.position.set(40, 35);
		root.addChild(bombs);

		// Acht hartjes in twee rijen van vier, 16 px uit elkaar bij een breedte van 17 — dus
		// één pixel overlap, precies zoals SidePanel::_drawHealth het doet.
		const hearts: Sprite[] = [];
		for (let i = 0; i < HEARTS; ++i) {
			const s = new Sprite(this.sheets.frame(health, 0, 0, HEART_W, HEART_H));
			s.scale.set(1 / this.sheets.textureScale);
			s.position.set(4 + (HEART_W - 1) * (i % 4), 47 + HEART_H * Math.floor(i / 4));
			root.addChild(s);
			hearts.push(s);
		}

		// Alles hieronder past alleen als er ruimte is; bij drie of vier spelers vervalt het.
		const extras = new Container();
		extras.y = 84;
		root.addChild(extras);

		// De vijf permanente bonussen als iconen van 15x15 uit bonus_icons.png, met daaronder
		// het niveau. Alleen oplichten is niet genoeg: je begint al met vijf bommen, dus dat
		// icoon zou permanent aanstaan en niets vertellen.
		const iconSprites: Sprite[] = [];
		const counts: Text[] = [];
		for (let i = 0; i < BONUS.N_PERMANENT_BONUS_TYPES; ++i) {
			const s = new Sprite(this.sheets.frame(icons, i * 15, 0, 15, 15));
			s.scale.set(1 / this.sheets.textureScale);
			s.position.set(3 + i * 18, 0);
			s.alpha = 0.25;
			extras.addChild(s);
			iconSprites.push(s);

			const c = label(8, 0xffffff);
			c.position.set(5 + i * 18, 13);
			extras.addChild(c);
			counts.push(c);
		}

		// De EXTRA-letters: extra_icons.png is 6 vakjes van 14x15, waarvan de eerste "nog
		// niet" betekent en 1..5 de letters E, X, T, R, A. SidePanel::_drawExtraLetters.
		const letters: Sprite[] = [];
		for (let i = 0; i < 5; ++i) {
			const s = new Sprite(this.sheets.frame(extraIcons, 0, 0, EXTRA_W, EXTRA_H));
			s.scale.set(1 / this.sheets.textureScale);
			s.position.set(6 + i * EXTRA_W, 26);
			extras.addChild(s);
			letters.push(s);
		}

		return { root, name, score, lives, bombs, hearts, icons: iconSprites, counts, extras, letters };
	}

	update(w: World, bombsLeft: (playerId: number) => number): void {
		this.levelText.text = `LV ${w.levelNum}`;

		const t = Math.max(0, Math.ceil(w.timeLeft));
		this.timeText.text = `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
		this.timeText.style.fill = w.hurryUp ? 0xff3300 : 0xffffff;

		this.statusText.text = w.extraGame
			? `EXTRA ${Math.ceil(w.extraGameT)}`
			: w.hurryUp
				? 'HURRY UP!'
				: '';

		// Bij één of twee spelers krijgen de blokken alle ruimte; bij drie of vier schuiven ze op.
		const present = w.players.filter((p) => p.present).length;
		const spacing = present <= 2 ? BLOCK_HEIGHT_ROOMY : BLOCK_HEIGHT;

		let slot = 0;
		for (let i = 0; i < this.blocks.length; ++i) {
			const block = this.blocks[i]!;
			const ps = w.players[i];
			if (!ps || !ps.present) {
				block.root.visible = false;
				continue;
			}
			block.root.visible = true;
			block.root.y = BLOCK_TOP + slot * spacing;
			block.root.alpha = ps.out ? 0.35 : 1;
			slot++;

			block.score.text = String(ps.score).padStart(7, '0');
			block.lives.text = `x${ps.remainingLives}`;
			block.bombs.text = `${bombsLeft(ps.id)}/${ps.powers.maxBombs} bom`;

			// Elk hartje is twee levenspunten waard; MAX_LIFE is 16, dus acht hartjes.
			// SidePanel::_drawHealth:88-104.
			const full = Math.floor(ps.life / 2);
			const half = ps.life % 2;
			for (let h = 0; h < block.hearts.length; ++h) {
				const frame = h < full ? HEART_FULL : h < full + half ? HEART_HALF : HEART_EMPTY;
				block.hearts[h]!.texture = this.sheets.frame(
					this.healthSheet!,
					frame * HEART_W,
					0,
					HEART_W,
					HEART_H,
				);
			}

			// Bij drie of vier spelers is er domweg geen ruimte voor de iconen; de aantallen
			// staan dan nog steeds als tekst op de regel hierboven.
			block.extras.visible = spacing >= BLOCK_HEIGHT_ROOMY;

			// Volgorde van bonus_icons.png is die van BonusType: bommen, lont, bereik,
			// schild, speedy. De eerste drie zijn blijvend en tonen hun niveau; de laatste
			// twee zijn tijdelijk en lichten op zolang ze lopen.
			const ent = w.entities.find((e) => e.kind === 'player' && e.playerId === ps.id);
			const upgraded = (on: boolean) => (on ? 1 : 0.3);

			block.icons[0]!.alpha = upgraded(ps.powers.maxBombs > DEFAULTS.maxBombs);
			block.counts[0]!.text = String(ps.powers.maxBombs);

			block.icons[1]!.alpha = upgraded(ps.powers.bombFuseTime < DEFAULTS.bombFuseTime);
			block.counts[1]!.text = ps.powers.bombFuseTime < DEFAULTS.bombFuseTime ? 'snel' : '';

			block.icons[2]!.alpha = upgraded(ps.powers.bombRadius > DEFAULTS.bombRadius);
			block.counts[2]!.text = String(ps.powers.bombRadius);

			block.icons[3]!.alpha = upgraded((ent?.shieldT ?? 0) > 0);
			block.counts[3]!.text = (ent?.shieldT ?? 0) > 0 ? String(Math.ceil(ent!.shieldT)) : '';

			block.icons[4]!.alpha = upgraded((ent?.dash ?? 0) > 0);
			block.counts[4]!.text = (ent?.dash ?? 0) > 0 ? String(Math.ceil(ent?.phaseT ?? 0)) : '';

			for (let l = 0; l < block.letters.length; ++l) {
				const idx = ps.letters[l] ? l + 1 : 0;
				block.letters[l]!.texture = this.sheets.frame(
					this.extraSheet!,
					idx * EXTRA_W,
					0,
					EXTRA_W,
					EXTRA_H,
				);
			}
		}
	}
}
