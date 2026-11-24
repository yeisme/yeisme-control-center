/**
 * One fixture track with something for the player's analysis to find: tone, a quiet stretch, a clipped stretch, tone.
 * Same rate, format and byte length as `wav()`, so the result's declared bytes and duration stay true.
 *
 * - 16 kHz mono, 16-bit; the first 30% is a 330 Hz tone, then 30% silence, 15% a sine driven past full scale, then tone.
 */
const rate = 16000;

export function markedWav(seconds: number, frequency: number) {
  const samples = Math.round(rate * seconds);
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24);
  buffer.writeUInt32LE(rate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(samples * 2, 40);
  const quietFrom = Math.round(samples * 0.3), clipFrom = Math.round(samples * 0.6), clipTo = Math.round(samples * 0.75);
  for (let i = 0; i < samples; i++) {
    const wave = Math.sin((2 * Math.PI * frequency * i) / rate);
    const value = i >= quietFrom && i < clipFrom ? 0
      : i >= clipFrom && i < clipTo ? Math.max(-1, Math.min(1, wave * 1.8)) * 32767
        : wave * 9000 * Math.min(1, i / 800, (samples - i) / 1600);
    buffer.writeInt16LE(Math.round(value), 44 + i * 2);
  }
  return buffer;
}

/** Swap a fixture track's bytes for the marked take of the same length; declared bytes and duration are unchanged. */
export function markAudio(media: Map<string, { mime: string; bytes: Buffer }>, key: string, seconds: number, frequency: number) {
  const current = media.get(key);
  if (!current) return;
  const bytes = markedWav(seconds, frequency);
  if (bytes.length !== current.bytes.length) throw new Error(`marked fixture audio ${key} changed length`);
  media.set(key, { mime: current.mime, bytes });
}
