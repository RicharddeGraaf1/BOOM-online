/**
 * Wat de simulatie meldt, in beeld brengen.
 *
 * De sim stuurt per tick een lijstje gebeurtenissen mee: een geluid, een flits, punten die
 * je verdiend hebt, of een aankondiging als HURRY UP. Die lijst werd alleen op geluid
 * afgezocht en verder weggegooid — vandaar dat een muntje oppakken niets deed en de extra
 * game zonder aankondiging begon.
 *
 * Alles hier is puur cosmetisch en leeft los van de wereldstaat: een gemiste flits maakt
 * niemand dood.
 */

import { Container, Sprite, Text, TextStyle, Texture } from 'pixi.js';
import { GAME_HEIGHT, GAME_WIDTH, TILE_SIZE, type GameEvent } from '@boom/sim';
import type { Sheets } from './sheets.js';

/** Hoe lang punten blijven staan, en hoe ver ze stijgen. */
const POINTS_TIME = 1.1;
const POINTS_RISE = 22;
/** flash.png is vier frames van 32x32. */
const FLASH_FRAME_TIME = 0.06;
const FLASH_FRAMES = 4;
const BANNER_TIME = 2.2;
/**
 * Eén zapper sloopt alle breekbare muren tegelijk; dat zijn zeventig puntentellers in
 * dezelfde frame. Daarboven voegt het niets meer toe en kost het alleen maar.
 */
const MAX_POINTS = 24;

const BANNERS: Record<string, string | undefined> = {
	hurryUp: 'hurryup.png',
	extraGame: 'extragame.png',
	gameOver: 'gameover.png',
	levelClear: undefined, // geen sprite in de assets; die melden we als tekst
};

interface Effect {
	view: Container;
	t: number;
	life: number;
	kind: 'points' | 'flash' | 'banner';
	x: number;
	y: number;
	frames?: Texture[];
}

export class Effects {
	readonly root = new Container();

	private readonly sheets: Sheets;
	private readonly textures = new Map<string, Texture>();
	private readonly active: Effect[] = [];

	constructor(sheets: Sheets) {
		this.sheets = sheets;
		this.root.zIndex = 2000; // boven de border, net als lif::conf::zindex::POINTS
	}

	async prepare(): Promise<void> {
		for (const file of ['flash.png', 'hurryup.png', 'extragame.png', 'gameover.png']) {
			if (!this.textures.has(file)) this.textures.set(file, await this.sheets.sheet(file));
		}
	}

	clear(): void {
		for (const fx of this.active) fx.view.destroy({ children: true });
		this.active.length = 0;
	}

	/** Neemt de gebeurtenissen van deze frame over. Geluid wordt elders afgehandeld. */
	handle(events: readonly GameEvent[]): void {
		for (const ev of events) {
			switch (ev.t) {
				case 'points':
					this.addPoints(ev.value, ev.x, ev.y, ev.boss === true);
					break;
				case 'fx':
					this.addFlash(ev.x, ev.y);
					break;
				case 'text':
					this.addBanner(ev.name);
					break;
				default:
					break;
			}
		}
	}

	private addPoints(value: number, x: number, y: number, boss: boolean): void {
		if (this.active.filter((fx) => fx.kind === 'points').length >= MAX_POINTS) return;
		const text = new Text({
			text: `+${value}`,
			style: new TextStyle({
				fontFamily: ['BoomPanel', 'monospace'],
				fontSize: boss ? 12 : 8,
				fill: boss ? 0xff66ff : 0xffcc00,
			}),
		});
		text.anchor.set(0.5, 1);

		const view = new Container();
		view.addChild(text);
		this.root.addChild(view);

		this.active.push({
			view,
			t: 0,
			life: POINTS_TIME,
			kind: 'points',
			x: x + TILE_SIZE / 2,
			y,
		});
	}

	private addFlash(x: number, y: number): void {
		const sheet = this.textures.get('flash.png');
		if (!sheet) return;

		const frames = Array.from({ length: FLASH_FRAMES }, (_, i) => this.sheets.tile(sheet, i));
		const sprite = new Sprite(frames[0]);
		sprite.scale.set(1 / this.sheets.textureScale);

		const view = new Container();
		view.addChild(sprite);
		this.root.addChild(view);

		this.active.push({
			view,
			t: 0,
			life: FLASH_FRAME_TIME * FLASH_FRAMES,
			kind: 'flash',
			x,
			y,
			frames,
		});
	}

	private addBanner(name: string): void {
		const file = BANNERS[name];
		const view = new Container();

		if (file) {
			const tex = this.textures.get(file);
			if (!tex) return;
			const sprite = new Sprite(tex);
			sprite.scale.set(1 / this.sheets.textureScale);
			sprite.anchor.set(0.5);
			view.addChild(sprite);
		} else {
			const text = new Text({
				text: 'LEVEL CLEAR',
				style: new TextStyle({
					fontFamily: ['BoomPanel', 'monospace'],
					fontSize: 16,
					fill: 0xffcc00,
				}),
			});
			text.anchor.set(0.5);
			view.addChild(text);
		}

		// Maar één aankondiging tegelijk: ze staan allemaal in het midden.
		for (const fx of this.active) if (fx.kind === 'banner') fx.t = fx.life;

		this.root.addChild(view);
		this.active.push({
			view,
			t: 0,
			life: BANNER_TIME,
			kind: 'banner',
			x: GAME_WIDTH / 2,
			y: GAME_HEIGHT / 2,
		});
	}

	update(dt: number): void {
		for (let i = this.active.length - 1; i >= 0; --i) {
			const fx = this.active[i]!;
			fx.t += dt;

			if (fx.t >= fx.life) {
				fx.view.destroy({ children: true });
				this.active.splice(i, 1);
				continue;
			}

			const progress = fx.t / fx.life;

			switch (fx.kind) {
				case 'points':
					fx.view.x = fx.x;
					fx.view.y = fx.y - POINTS_RISE * progress;
					// De laatste derde uitfaden; daarvoor volledig leesbaar houden.
					fx.view.alpha = progress < 0.66 ? 1 : 1 - (progress - 0.66) / 0.34;
					break;

				case 'flash': {
					fx.view.x = fx.x;
					fx.view.y = fx.y;
					const frame = Math.min(
						FLASH_FRAMES - 1,
						Math.floor(fx.t / FLASH_FRAME_TIME),
					);
					const sprite = fx.view.children[0] as Sprite | undefined;
					if (sprite && fx.frames) sprite.texture = fx.frames[frame]!;
					break;
				}

				case 'banner':
					fx.view.x = fx.x;
					fx.view.y = fx.y;
					// Kort inzwellen en aan het eind uitfaden.
					fx.view.scale.set(progress < 0.12 ? 0.8 + (progress / 0.12) * 0.2 : 1);
					fx.view.alpha = progress < 0.8 ? 1 : 1 - (progress - 0.8) / 0.2;
					break;
			}
		}
	}
}
