/**
 * Het zijpaneel: score, tijd, levens, gezondheid, bommen en bonussen.
 *
 * Het origineel tekent dit met losse sprites uit panel.png, playerheads.png en
 * bonus_icons.png (src/ui/SidePanel.cpp), voor twee spelers. Wij hebben er maximaal vier, en
 * 96 pixels breed blijft 96 pixels breed — vandaar dat de gezondheid hier een balkje is in
 * plaats van acht hartjes: acht sprites van 17 pixels passen simpelweg niet naast elkaar.
 */

import { Container, Graphics, Sprite, Text, TextStyle, Texture } from 'pixi.js';
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
const BLOCK_HEIGHT_ROOMY = 140;

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
	health: Graphics;
	icons: Sprite[];
	/** Aantal onder het icoon, voor de upgrades die een niveau hebben. */
	counts: Text[];
}

export class Hud {
	readonly root = new Container();

	private readonly sheets: Sheets;
	private readonly blocks: PlayerBlock[] = [];
	private bg: Sprite | null = null;
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

		this.bg = new Sprite(panel);
		this.bg.scale.set(1 / this.sheets.textureScale);
		this.root.addChild(this.bg);

		this.levelText.position.set(6, HEADER_TOP);
		this.timeText.position.set(50, HEADER_TOP - 2);
		this.statusText.position.set(6, HEADER_TOP + 14);
		this.root.addChild(this.levelText, this.timeText, this.statusText);

		for (let i = 0; i < MAX_PLAYERS; ++i) {
			const block = this.makeBlock(heads, icons, i);
			block.root.position.set(0, BLOCK_TOP + i * BLOCK_HEIGHT);
			this.root.addChild(block.root);
			this.blocks.push(block);
		}
	}

	private makeBlock(heads: Texture, icons: Texture, index: number): PlayerBlock {
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

		const health = new Graphics();
		health.position.set(4, 48);
		root.addChild(health);

		// De vijf permanente bonussen als iconen van 15x15 uit bonus_icons.png, met daaronder
		// het niveau. Alleen oplichten is niet genoeg: je begint al met vijf bommen, dus dat
		// icoon zou permanent aanstaan en niets vertellen.
		const iconSprites: Sprite[] = [];
		const counts: Text[] = [];
		for (let i = 0; i < BONUS.N_PERMANENT_BONUS_TYPES; ++i) {
			const s = new Sprite(this.sheets.frame(icons, i * 15, 0, 15, 15));
			s.scale.set(1 / this.sheets.textureScale);
			s.position.set(3 + i * 18, 56);
			s.alpha = 0.25;
			root.addChild(s);
			iconSprites.push(s);

			const c = label(8, 0xffffff);
			c.position.set(5 + i * 18, 69);
			root.addChild(c);
			counts.push(c);
		}

		return { root, name, score, lives, bombs, health, icons: iconSprites, counts };
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

			const frac = Math.max(0, Math.min(1, ps.life / PLAYER.MAX_LIFE));
			block.health
				.clear()
				.rect(0, 0, 88, 6)
				.fill({ color: 0x000000, alpha: 0.5 })
				.rect(0, 0, Math.round(88 * frac), 6)
				.fill({ color: frac > 0.35 ? 0x33cc33 : 0xff3300 });

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
		}
	}
}
