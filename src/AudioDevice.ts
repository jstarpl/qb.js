import * as MMLIterator from 'mml-iterator'
import SeqEmitter = require('seq-emitter')

interface IMMLEmitterConfig {
	MMLIterator?: MMLIterator
	reverseOctave?: boolean
	context?: AudioContext
}

// Taken from: mml-emitter by Nao Yonamine
// https://github.com/mohayonao/mml-emitter
// License: MIT
class MMLEmitter extends SeqEmitter {
	tracksNum: number

	constructor(source, config: IMMLEmitterConfig = {}) {
		if (config.reverseOctave) {
			source = MMLEmitter.reverseOctave(source)
		}

		let MMLIteratorClass = config.MMLIterator || MMLIterator
		let tracks = source.split(';')

		tracks = tracks.filter(source => !!source.trim())
		tracks = tracks.map(track => new MMLIteratorClass(track, config))

		super(tracks, config)

		this.tracksNum = tracks.length
	}

	private static reverseOctave(source) {
		return source.replace(/[<>]/g, str => (str === '<' ? '>' : '<'))
	}
}

export interface IAudioDevice {
	beep(num: number): Promise<void>
	setBeep(num: number, data: string | Blob): Promise<void>
	clearBeep(num: number): void

	playMusic(str: string, repeat?: number): Promise<void>
	stopMusic(): void
}

export class AudioDevice implements IAudioDevice {
	private beeps: {
		[key: number]: HTMLAudioElement
	} = {}
	private audioContext: AudioContext
	private currentMMLEmitter: MMLEmitter | undefined

	constructor() {
		this.audioContext = new AudioContext()
	}

	beep(num: number): Promise<void> {
		return new Promise((resolve, reject) => {
			const endedHandler = () => {
				resolve()
				this.beeps[num].removeEventListener('ended', endedHandler)
			}
			if (!this.beeps[num]) reject('Beep not set')
			this.beeps[num].currentTime = 0
			this.beeps[num].addEventListener('ended', endedHandler)
			this.beeps[num].play().catch(e => reject(e))
		})
	}
	setBeep(num: number, data: string | Blob): Promise<void> {
		return new Promise((resolve, reject) => {
			let beepAudio: HTMLAudioElement
			if (typeof data === 'string') {
				beepAudio = new Audio(data)
			} else {
				beepAudio = new Audio(URL.createObjectURL(data))
			}
			this.beeps[num] = beepAudio
			beepAudio.addEventListener('canplaythrough', () => {
				resolve()
			})
			beepAudio.addEventListener('error', e => {
				reject(e)
			})
		})
	}
	clearBeep(num: number): void {
		delete this.beeps[num]
	}
	playMusic(mml: string, repeat?: number): Promise<void> {
		return new Promise<void>(resolve => {
			const config = { context: this.audioContext }

			if (this.currentMMLEmitter) {
				this.currentMMLEmitter.stop()
				this.currentMMLEmitter = undefined
			}

			const mmlEmitter = new MMLEmitter(mml, config)
			mmlEmitter.on('note', e => {
				// console.log('NOTE: ' + JSON.stringify(e))
				this.playNote(e)
			})
			mmlEmitter.on('end:all', () => {
				// console.log('END : ' + JSON.stringify(e))
				// loop forever
				if (repeat === undefined || repeat > 1) {
					resolve(this.playMusic(mml, repeat === undefined ? undefined : repeat - 1))
				} else {
					resolve()
				}
			})

			mmlEmitter.start()
			this.currentMMLEmitter = mmlEmitter
		})
	}
	stopMusic(): void {
		if (this.currentMMLEmitter) {
			this.currentMMLEmitter.stop()
			delete this.currentMMLEmitter
		}
	}
	private mtof(noteNumber: number) {
		return 440 * Math.pow(2, (noteNumber - 69) / 12)
	}
	private playNote(e: any) {
		const t0 = e.playbackTime
		const t1 = t0 + e.duration * (e.quantize / 100)
		const t2 = t1 + 0.5
		const osc1 = this.audioContext.createOscillator()
		const osc2 = this.audioContext.createOscillator()
		const amp = this.audioContext.createGain()
		const volume = (1 / this.currentMMLEmitter!.tracksNum / 3) * (e.velocity / 128)

		osc1.frequency.value = this.mtof(e.noteNumber)
		osc1.detune.setValueAtTime(+12, t0)
		osc1.detune.linearRampToValueAtTime(+1, t1)
		osc1.start(t0)
		osc1.stop(t2)
		osc1.connect(amp)

		osc2.frequency.value = this.mtof(e.noteNumber)
		osc2.detune.setValueAtTime(-12, t0)
		osc2.detune.linearRampToValueAtTime(-1, t1)
		osc2.start(t0)
		osc2.stop(t2)
		osc2.connect(amp)

		amp.gain.setValueAtTime(volume, t0)
		amp.gain.setValueAtTime(volume, t1)
		amp.gain.exponentialRampToValueAtTime(1e-3, t2)
		amp.connect(this.audioContext.destination)
	}
}
