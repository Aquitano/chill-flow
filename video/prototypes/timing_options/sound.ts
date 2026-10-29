import { endCardStart } from "./refined";

const cues = [
  { raster: 1.3, pitch: 740, gain: .085, decay: .035 },
  { raster: 2.1, pitch: 1120, gain: .055, decay: .024 },
  { raster: 3.65, pitch: 330, gain: .075, decay: .085 },
] as const;

export function typographyAudio(intro: number, seconds: number) {
  const rate = 44100;
  const samples = new Float32Array(seconds * rate);
  let seed = 47;
  for (const ending of [false, true]) {
    for (const cue of cues) {
      const second = ending ? endCardStart + .6 + (cue.raster - .5) / 4.1 : cue.raster / 3.8 * intro;
      const start = Math.round(second * rate);
      let filtered = 0;
      for (let i = 0; i < rate * .5 && start + i < samples.length; i++) {
        const t = i / rate;
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        filtered += .3 * (seed / 2147483648 - 1 - filtered);
        const attack = 1 - Math.exp(-t / .001);
        const body = Math.sin(2 * Math.PI * cue.pitch * t) * Math.exp(-t / cue.decay);
        const tick = filtered * Math.exp(-t / .009);
        samples[start + i] += cue.gain * (ending ? .8 : 1) * attack * (.65 * body + .35 * tick);
      }
    }
  }
  const wav = Buffer.alloc(44 + samples.length * 2);
  wav.write("RIFF", 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write("data", 36); wav.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) wav.writeInt16LE(Math.round(samples[i] * 32767), 44 + i * 2);
  return wav;
}
