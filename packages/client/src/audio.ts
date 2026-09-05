/**
 * Geluid en muziek.
 *
 * De sim geeft alleen gebeurtenissen door ("speel explosion.ogg"); wat daarmee gebeurt is
 * puur een clientzaak. Dat moet ook wel: op de server bestaat er geen geluidskaart.
 *
 * De muziek heeft loop-punten in assets/music/loops.txt — het intro speelt één keer en
 * daarna herhaalt alleen het middenstuk, precies zoals in het origineel.
 */

const SOUND_DIR = 'assets/sounds';
const MUSIC_DIR = 'assets/music';

/** Hoeveel keer hetzelfde geluid tegelijk mag klinken; anders wordt een kettingexplosie een muur. */
const MAX_VOICES_PER_SOUND = 4;

interface LoopPoint {
	start: number;
	length: number;
}

export class Audio {
	private ctx: AudioContext | null = null;
	private readonly buffers = new Map<string, AudioBuffer>();
	private readonly pending = new Map<string, Promise<AudioBuffer | null>>();
	private readonly playing = new Map<string, number>();
	private readonly loops = new Map<number, LoopPoint>();

	private sfxGain: GainNode | null = null;
	private musicGain: GainNode | null = null;
	private musicSource: AudioBufferSourceNode | null = null;
	private currentTrack = -1;

	sfxVolume = 0.6;
	musicVolume = 0.35;
	muted = false;

	/** Browsers laten geluid pas toe na een klik of toets; vandaar de aparte start. */
	async unlock(): Promise<void> {
		if (this.ctx) {
			if (this.ctx.state === 'suspended') await this.ctx.resume();
			return;
		}
		this.ctx = new AudioContext();
		this.sfxGain = this.ctx.createGain();
		this.musicGain = this.ctx.createGain();
		this.sfxGain.gain.value = this.sfxVolume;
		this.musicGain.gain.value = this.musicVolume;
		this.sfxGain.connect(this.ctx.destination);
		this.musicGain.connect(this.ctx.destination);
		await this.loadLoopPoints();
	}

	/**
	 * loops.txt bevat per regel "track start lengte" in seconden. Ontbreekt het bestand,
	 * dan loopt een track gewoon in zijn geheel rond.
	 */
	private async loadLoopPoints(): Promise<void> {
		try {
			const res = await fetch(`${MUSIC_DIR}/loops.txt`);
			if (!res.ok) return;
			const text = await res.text();
			for (const line of text.split(/\r?\n/)) {
				const parts = line.trim().split(/\s+/);
				if (parts.length < 3) continue;
				const track = Number(parts[0]);
				const start = Number(parts[1]);
				const length = Number(parts[2]);
				if (Number.isFinite(track) && Number.isFinite(start) && Number.isFinite(length))
					this.loops.set(track, { start, length });
			}
		} catch {
			// Geen loop-punten: niet erg.
		}
	}

	private async buffer(url: string): Promise<AudioBuffer | null> {
		if (!this.ctx) return null;
		const cached = this.buffers.get(url);
		if (cached) return cached;

		let p = this.pending.get(url);
		if (!p) {
			p = (async () => {
				try {
					const res = await fetch(url);
					if (!res.ok) return null;
					const data = await res.arrayBuffer();
					const buf = await this.ctx!.decodeAudioData(data);
					this.buffers.set(url, buf);
					return buf;
				} catch {
					return null;
				}
			})();
			this.pending.set(url, p);
		}
		return p;
	}

	play(name: string): void {
		if (!this.ctx || this.muted) return;
		const active = this.playing.get(name) ?? 0;
		if (active >= MAX_VOICES_PER_SOUND) return;

		void this.buffer(`${SOUND_DIR}/${name}`).then((buf) => {
			if (!buf || !this.ctx || !this.sfxGain) return;
			const src = this.ctx.createBufferSource();
			src.buffer = buf;
			src.connect(this.sfxGain);
			this.playing.set(name, (this.playing.get(name) ?? 0) + 1);
			src.onended = () => this.playing.set(name, Math.max(0, (this.playing.get(name) ?? 1) - 1));
			src.start();
		});
	}

	async playMusic(track: number): Promise<void> {
		if (!this.ctx || !this.musicGain) return;
		if (track === this.currentTrack) return;
		this.stopMusic();
		this.currentTrack = track;

		const buf = await this.buffer(`${MUSIC_DIR}/music${track}.ogg`);
		if (!buf || this.currentTrack !== track) return;

		const src = this.ctx.createBufferSource();
		src.buffer = buf;
		src.loop = true;

		const loop = this.loops.get(track);
		if (loop && loop.length > 0) {
			src.loopStart = loop.start;
			src.loopEnd = loop.start + loop.length;
		}

		src.connect(this.musicGain);
		src.start();
		this.musicSource = src;
	}

	stopMusic(): void {
		if (this.musicSource) {
			try {
				this.musicSource.stop();
			} catch {
				// Al gestopt.
			}
			this.musicSource.disconnect();
			this.musicSource = null;
		}
		this.currentTrack = -1;
	}

	setSfxVolume(v: number): void {
		this.sfxVolume = v;
		if (this.sfxGain) this.sfxGain.gain.value = v;
	}

	setMusicVolume(v: number): void {
		this.musicVolume = v;
		if (this.musicGain) this.musicGain.gain.value = v;
	}

	setMuted(m: boolean): void {
		this.muted = m;
		if (this.sfxGain) this.sfxGain.gain.value = m ? 0 : this.sfxVolume;
		if (this.musicGain) this.musicGain.gain.value = m ? 0 : this.musicVolume;
	}
}
