/**
 * Het zijpaneel: score, tijd, levens, gezondheid, bommen en bonussen.
 *
 * Het origineel tekent dit met losse sprites uit panel.png, playerheads.png en
 * bonus_icons.png (src/ui/SidePanel.cpp), voor twee spelers. Wij hebben er maximaal vier, en
 * 96 pixels breed blijft 96 pixels breed — vandaar dat de gezondheid hier een balkje is in
 * plaats van acht hartjes: acht sprites van 17 pixels passen simpelweg niet naast elkaar.
 */

import { Container, Graphics, Sprite, Text, TextStyle, Texture } from 'pixi.js';
import { MAX_PLAYERS, bonus as BONUS, player as PLAYER, type World } from '@boom/sim';
import { PLAYER_TINTS } from './playerColors.js';
import type { Sheets } from './sheets.js';

const FONT = 'BoomPanel';
const BLOCK_TOP = 52;
const BLOCK_HEIGHT = 106;

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

		this.levelText.position.set(6, 6);
		this.timeText.position.set(6, 18);
		this.statusText.position.set(6, 34);
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
		score.position.set(4, 24);
		root.addChild(score);

		const lives = label(8, 0xcccccc);
		lives.position.set(4, 35);
		root.addChild(lives);

		const bombs = label(8, 0xcccccc);
		bombs.position.set(4, 46);
		root.addChild(bombs);

		const health = new Graphics();
		health.position.set(4, 60);
		root.addChild(health);

		// De vijf permanente bonussen als iconen van 15x15 uit bonus_icons.png.
		const iconSprites: Sprite[] = [];
		for (let i = 0; i < BONUS.N_PERMANENT_BONUS_TYPES; ++i) {
			const s = new Sprite(this.sheets.frame(icons, i * 15, 0, 15, 15));
			s.scale.set(1 / this.sheets.textureScale);
			s.position.set(4 + i * 17, 72);
			s.alpha = 0.2;
			root.addChild(s);
			iconSprites.push(s);
		}

		return { root, name, score, lives, bombs, health, icons: iconSprites };
	}

	update(w: World, bombsLeft: (playerId: number) => number): void {
		this.levelText.text = `LEVEL ${w.levelNum}`;

		const t = Math.max(0, Math.ceil(w.timeLeft));
		this.timeText.text = `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
		this.timeText.style.fill = w.hurryUp ? 0xff3300 : 0xffffff;

		this.statusText.text = w.extraGame
			? `EXTRA ${Math.ceil(w.extraGameT)}`
			: w.hurryUp
				? 'HURRY UP!'
				: '';

		// Bij twee spelers krijgen de blokken alle ruimte; bij drie of vier schuiven ze op.
		const present = w.players.filter((p) => p.present).length;
		const spacing = present <= 2 ? BLOCK_HEIGHT + 60 : BLOCK_HEIGHT;

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
			block.lives.text = `LIVES ${ps.remainingLives}`;
			block.bombs.text = `BOMB ${bombsLeft(ps.id)}/${ps.powers.maxBombs}`;

			const frac = Math.max(0, Math.min(1, ps.life / PLAYER.MAX_LIFE));
			block.health
				.clear()
				.rect(0, 0, 88, 6)
				.fill({ color: 0x000000, alpha: 0.5 })
				.rect(0, 0, Math.round(88 * frac), 6)
				.fill({ color: frac > 0.35 ? 0x33cc33 : 0xff3300 });

			block.icons[0]!.alpha = ps.powers.maxBombs > 1 ? 1 : 0.2;
			block.icons[1]!.alpha = ps.powers.bombFuseTime < 5 ? 1 : 0.2;
			block.icons[2]!.alpha = ps.powers.bombRadius > 2 ? 1 : 0.2;
			block.icons[3]!.alpha = 0.2;
			block.icons[4]!.alpha = 0.2;
		}
	}
}
