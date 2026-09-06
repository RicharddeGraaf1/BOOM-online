/**
 * Toetsenbord.
 *
 * Vier schema's, zodat lokale co-op op één toetsenbord werkt. Online gebruikt iedereen
 * schema 1 — daar hoeft niemand met z'n handen te schuiven.
 *
 *   1  pijltjes    + spatie
 *   2  WASD        + linker shift
 *   3  IJKL        + U
 *   4  numpad 8456 + numpad 0
 *
 * Met drie of vier man achter één toetsenbord is het krap; dat is de prijs van lokale co-op.
 */

import { NO_INPUT, type PlayerInput } from '@boom/sim';

function isTyping(target: EventTarget | null): boolean {
	const el = target as HTMLElement | null;
	if (!el) return false;
	const tag = el.tagName;
	return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable === true;
}

const SCHEME_1: Record<string, keyof PlayerInput> = {
	ArrowUp: 'up',
	ArrowDown: 'down',
	ArrowLeft: 'left',
	ArrowRight: 'right',
	Space: 'bomb',
	Enter: 'bomb',
};

const SCHEME_2: Record<string, keyof PlayerInput> = {
	KeyW: 'up',
	KeyS: 'down',
	KeyA: 'left',
	KeyD: 'right',
	ShiftLeft: 'bomb',
	KeyQ: 'bomb',
};

const SCHEME_3: Record<string, keyof PlayerInput> = {
	KeyI: 'up',
	KeyK: 'down',
	KeyJ: 'left',
	KeyL: 'right',
	KeyU: 'bomb',
	KeyO: 'bomb',
};

const SCHEME_4: Record<string, keyof PlayerInput> = {
	Numpad8: 'up',
	Numpad5: 'down',
	Numpad4: 'left',
	Numpad6: 'right',
	Numpad0: 'bomb',
	NumpadAdd: 'bomb',
};

const SCHEMES = [SCHEME_1, SCHEME_2, SCHEME_3, SCHEME_4];

export class Input {
	private readonly down = new Set<string>();
	/** Toetsen die deze tick voor het eerst ingedrukt werden. */
	private readonly pressed = new Set<string>();

	constructor(target: EventTarget = window) {
		target.addEventListener('keydown', (ev) => {
			const e = ev as KeyboardEvent;
			if (e.repeat) return;
			// Niet meeluisteren terwijl iemand een kamercode intypt: die bevat gewoon letters
			// die hier een sneltoets zijn.
			if (isTyping(e.target)) return;
			if (e.code === 'Escape' || SCHEMES.some((m) => e.code in m)) e.preventDefault();
			this.down.add(e.code);
			this.pressed.add(e.code);
		});
		target.addEventListener('keyup', (ev) => {
			this.down.delete((ev as KeyboardEvent).code);
		});
		// Bij het verliezen van focus alles loslaten, anders blijft de speler doorlopen.
		window.addEventListener('blur', () => this.down.clear());
	}

	read(scheme: 1 | 2 | 3 | 4): PlayerInput {
		const map = SCHEMES[scheme - 1] ?? SCHEME_1;
		const input: PlayerInput = { ...NO_INPUT };
		for (const [code, action] of Object.entries(map)) {
			if (this.down.has(code)) input[action] = true;
		}
		return input;
	}

	isDown(code: string): boolean {
		return this.down.has(code);
	}

	/** Waar als deze toets sinds de vorige `endFrame()` is ingedrukt. */
	justPressed(code: string): boolean {
		return this.pressed.has(code);
	}

	endFrame(): void {
		this.pressed.clear();
	}
}
