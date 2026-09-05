/**
 * Toetsenbord.
 *
 * Twee schema's, zodat lokale co-op op één toetsenbord werkt: pijltjes + spatie voor
 * speler 1, WASD + linker shift voor speler 2. Online gebruikt elke speler schema 1.
 */

import { NO_INPUT, type PlayerInput } from '@boom/sim';

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

export class Input {
	private readonly down = new Set<string>();
	/** Toetsen die deze tick voor het eerst ingedrukt werden. */
	private readonly pressed = new Set<string>();

	constructor(target: EventTarget = window) {
		target.addEventListener('keydown', (ev) => {
			const e = ev as KeyboardEvent;
			if (e.repeat) return;
			if (e.code in SCHEME_1 || e.code in SCHEME_2 || e.code === 'Escape') e.preventDefault();
			this.down.add(e.code);
			this.pressed.add(e.code);
		});
		target.addEventListener('keyup', (ev) => {
			this.down.delete((ev as KeyboardEvent).code);
		});
		// Bij het verliezen van focus alles loslaten, anders blijft de speler doorlopen.
		window.addEventListener('blur', () => this.down.clear());
	}

	read(scheme: 1 | 2): PlayerInput {
		const map = scheme === 1 ? SCHEME_1 : SCHEME_2;
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
