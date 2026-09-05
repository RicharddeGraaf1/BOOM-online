/**
 * Scherpere graphics zonder nieuwe art: Scale2x, twee keer toegepast.
 *
 * Nearest-neighbour is scherp maar blijft blokkerig; bilineair is glad maar wazig. Scale2x
 * (AdvMAME2x) zit ertussenin: het kijkt per pixel naar zijn vier buren en vult alleen daar
 * subpixels in waar een diagonale rand loopt. Er wordt geen enkele nieuwe kleur verzonnen —
 * het palet van het origineel blijft exact intact — maar trapjes worden afgerond. Twee keer
 * toegepast levert 4x resolutie op, en daarmee ziet de art er op een groot scherm merkbaar
 * gladder uit terwijl het nog steeds BOOM is.
 *
 *   B          E0 = (D==B && B!=F && D!=H) ? D : E
 * D E F        E1 = (B==F && B!=D && F!=H) ? F : E
 *   H          E2 = (D==H && D!=B && H!=F) ? D : E
 *              E3 = (H==F && D!=H && B!=F) ? F : E
 *
 * Belangrijk detail: sprite-sheets worden per frame opgeschaald. Zou je de hele sheet in één
 * keer doen, dan kijkt de rand van frame 1 naar de pixels van frame 2 en krijg je gekleurde
 * randjes die er in het origineel niet zijn.
 */

/** Eén pixel als 32-bits woord, zodat vergelijken één instructie is. */
type Px = Uint32Array;

/** Losstaand en exporteerbaar zodat de kern zonder canvas te testen is. */
export function scale2x(src: Px, w: number, h: number): { data: Px; w: number; h: number } {
	const dw = w * 2;
	const dh = h * 2;
	const dst = new Uint32Array(dw * dh);

	const at = (x: number, y: number): number => {
		// Randen klemmen: buiten het frame telt de rand zelf, niet de buurframe.
		const cx = x < 0 ? 0 : x >= w ? w - 1 : x;
		const cy = y < 0 ? 0 : y >= h ? h - 1 : y;
		return src[cy * w + cx]!;
	};

	for (let y = 0; y < h; ++y) {
		for (let x = 0; x < w; ++x) {
			const E = at(x, y);
			const B = at(x, y - 1);
			const D = at(x - 1, y);
			const F = at(x + 1, y);
			const H = at(x, y + 1);

			const e0 = D === B && B !== F && D !== H ? D : E;
			const e1 = B === F && B !== D && F !== H ? F : E;
			const e2 = D === H && D !== B && H !== F ? D : E;
			const e3 = H === F && D !== H && B !== F ? F : E;

			const o = y * 2 * dw + x * 2;
			dst[o] = e0;
			dst[o + 1] = e1;
			dst[o + dw] = e2;
			dst[o + dw + 1] = e3;
		}
	}

	return { data: dst, w: dw, h: dh };
}

export const UPSCALE_FACTOR = 4;

/**
 * Schaalt een afbeelding 4x op. `cell` geeft de rastermaat van de sprite-sheet: is die
 * gezet en past hij precies, dan wordt elk vakje los behandeld. Voor doorlopende beelden
 * (border, achtergrond, zijpaneel) laat je `cell` weg.
 */
export function upscaleImage(
	source: CanvasImageSource,
	width: number,
	height: number,
	cell?: number,
): HTMLCanvasElement {
	const read = document.createElement('canvas');
	read.width = width;
	read.height = height;
	const rctx = read.getContext('2d', { willReadFrequently: true })!;
	rctx.imageSmoothingEnabled = false;
	rctx.drawImage(source, 0, 0);

	const out = document.createElement('canvas');
	out.width = width * UPSCALE_FACTOR;
	out.height = height * UPSCALE_FACTOR;
	const octx = out.getContext('2d')!;

	const usesCells = cell !== undefined && width % cell === 0 && height % cell === 0;
	const cw = usesCells ? cell : width;
	const ch = usesCells ? cell : height;

	for (let cy = 0; cy < height; cy += ch) {
		for (let cx = 0; cx < width; cx += cw) {
			const img = rctx.getImageData(cx, cy, cw, ch);
			const px = new Uint32Array(img.data.buffer.slice(0));

			const once = scale2x(px, cw, ch);
			const twice = scale2x(once.data, once.w, once.h);

			// Het Uint32Array en het ImageData delen dezelfde buffer; de cast is nodig omdat
			// de DOM-typings een ImageDataArray verwachten.
			const bytes = new Uint8ClampedArray(twice.data.buffer) as unknown as ImageDataArray;
			const outImg = new ImageData(bytes, twice.w, twice.h);
			octx.putImageData(outImg, cx * UPSCALE_FACTOR, cy * UPSCALE_FACTOR);
		}
	}

	return out;
}
