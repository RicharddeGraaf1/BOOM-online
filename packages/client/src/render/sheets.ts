/**
 * Sprite-sheets laden en in frames opdelen.
 *
 * Twee beeldmodi:
 *   crisp  — de originele pixels, nearest-neighbour, hele schaalfactor. Pixel-perfect.
 *   smooth — dezelfde art 4x opgeschaald met Scale2x en lineair gefilterd. Gladder, en
 *            omdat de textuur vier keer zoveel pixels heeft, ook op een 4K-scherm nog scherp.
 *
 * Voor de rest van de renderer maakt de modus niets uit: `frame()` rekent altijd in logische
 * spelpixels, en `textureScale` zegt met welke factor een sprite geschaald moet worden.
 */

import { CanvasSource, ImageSource, Rectangle, Texture, TextureSource } from 'pixi.js';
import { TILE_SIZE } from '@boom/sim';
import { UPSCALE_FACTOR, upscaleImage } from './upscale.js';

export { CORE_SHEETS } from './sheetNames.js';

export type RenderMode = 'crisp' | 'smooth';

const GRAPHICS = 'assets/graphics';

/**
 * Sheets waarvan de opschaling per vakje moet gebeuren, met hun rastermaat. Zonder dit
 * kijkt de rand van het ene frame naar de pixels van het volgende.
 */
const CELL_SIZES: Record<string, number> = {
	'player1.png': TILE_SIZE,
	'player2.png': TILE_SIZE,
	'bomb.png': TILE_SIZE,
	'bonuses.png': TILE_SIZE,
	'coin.png': TILE_SIZE,
	'teleport.png': TILE_SIZE,
	'fixed.png': TILE_SIZE,
	'breakable.png': TILE_SIZE,
	'explosionC.png': TILE_SIZE,
	'explosionH.png': TILE_SIZE,
	'explosionV.png': TILE_SIZE,
	'flash.png': TILE_SIZE,
	'aliensprite.png': TILE_SIZE,
	'extra_letters.png': TILE_SIZE,
	'bullets.png': TILE_SIZE,
};

for (let i = 1; i <= 10; ++i) CELL_SIZES[`enemy${i}.png`] = TILE_SIZE;
for (const f of [
	'shot.png',
	'fireball.png',
	'mg_shot.png',
	'lightbolt.png',
	'flame.png',
	'plasma.png',
	'magma.png',
	'bossbullet.png',
])
	CELL_SIZES[f] = TILE_SIZE;

function loadImage(url: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const img = new Image();
		img.onload = () => resolve(img);
		img.onerror = () => reject(new Error(`kon ${url} niet laden`));
		img.src = url;
	});
}

export class Sheets {
	readonly mode: RenderMode;
	/** Aantal textuurpixels per logische spelpixel. */
	readonly textureScale: number;

	private readonly cache = new Map<string, Promise<Texture>>();

	constructor(mode: RenderMode) {
		this.mode = mode;
		this.textureScale = mode === 'smooth' ? UPSCALE_FACTOR : 1;
		TextureSource.defaultOptions.scaleMode = mode === 'smooth' ? 'linear' : 'nearest';
	}

	sheet(file: string): Promise<Texture> {
		let p = this.cache.get(file);
		if (!p) {
			p = this.build(file);
			this.cache.set(file, p);
		}
		return p;
	}

	/** Laadt alvast een reeks sheets, zodat er tijdens het spelen niets hapert. */
	async preload(files: readonly string[]): Promise<void> {
		await Promise.all(files.map((f) => this.sheet(f)));
	}

	private async build(file: string): Promise<Texture> {
		const img = await loadImage(`${GRAPHICS}/${file}`);

		if (this.mode === 'crisp') {
			const source = new ImageSource({ resource: img, scaleMode: 'nearest' });
			return new Texture({ source });
		}

		const canvas = upscaleImage(img, img.naturalWidth, img.naturalHeight, CELL_SIZES[file]);
		const source = new CanvasSource({ resource: canvas, scaleMode: 'linear' });
		return new Texture({ source });
	}

	/** Een deelvlak van een sheet, opgegeven in logische spelpixels. */
	frame(sheet: Texture, x: number, y: number, w: number, h: number): Texture {
		const s = this.textureScale;
		return new Texture({
			source: sheet.source,
			frame: new Rectangle(x * s, y * s, w * s, h * s),
		});
	}

	/** Eén tegel (32x32) uit een sheet, op kolom/rij. */
	tile(sheet: Texture, col: number, row = 0): Texture {
		return this.frame(sheet, col * TILE_SIZE, row * TILE_SIZE, TILE_SIZE, TILE_SIZE);
	}
}

