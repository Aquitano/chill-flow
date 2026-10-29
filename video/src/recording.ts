import type { Recording } from "./walkthrough";

type Metadata = Pick<Recording, "columns" | "rows" | "fps" | "inputs" | "octants"> & { symbols: string[] };

export function packRecording(recording: Recording): Uint8Array {
  const symbols = [...new Set(recording.frames.flatMap(frame => frame.map(cell => cell[1])))];
  if (symbols.length > 65536 || recording.columns * recording.rows > 65536) {
    throw new Error("The terminal recording exceeds the compact format's limits.");
  }
  const glyphs = new Map(symbols.map((symbol, index) => [symbol, index]));
  const metadata = new TextEncoder().encode(JSON.stringify({ columns: recording.columns, rows: recording.rows, fps: recording.fps, inputs: recording.inputs, octants: recording.octants, symbols }));
  const cells = recording.frames.reduce((count, frame) => count + frame.length, 0);
  const bytes = new Uint8Array(12 + metadata.length + recording.styles.length * 7 + recording.frames.length * 4 + cells * 8);
  const view = new DataView(bytes.buffer);
  let offset = 0;
  const uint32 = (value: number) => { view.setUint32(offset, value, true); offset += 4; };
  uint32(metadata.length);
  bytes.set(metadata, offset); offset += metadata.length;
  uint32(recording.styles.length);
  for (const [fg, bg, flags] of recording.styles) {
    for (const color of [fg, bg]) {
      const rgb = Number.parseInt(color.slice(1), 16);
      bytes[offset++] = rgb >>> 16;
      bytes[offset++] = rgb >>> 8;
      bytes[offset++] = rgb;
    }
    bytes[offset++] = flags;
  }
  uint32(recording.frames.length);
  for (const frame of recording.frames) {
    uint32(frame.length);
    let previous = 0;
    for (const [index, symbol, style] of frame) {
      view.setUint16(offset, index - previous, true);
      view.setUint32(offset + 2, style, true);
      view.setUint16(offset + 6, glyphs.get(symbol)!, true);
      offset += 8;
      previous = index;
    }
  }
  return bytes;
}

export function unpackRecording(buffer: ArrayBuffer): Recording {
  const view = new DataView(buffer);
  let offset = 0;
  const uint32 = () => { const value = view.getUint32(offset, true); offset += 4; return value; };
  const metadataLength = uint32();
  const metadata = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, offset, metadataLength))) as Metadata;
  offset += metadataLength;
  const color = () => {
    const rgb = view.getUint8(offset) * 65536 + view.getUint8(offset + 1) * 256 + view.getUint8(offset + 2);
    offset += 3;
    return `#${rgb.toString(16).padStart(6, "0")}`;
  };
  const styles: Recording["styles"] = Array.from({ length: uint32() }, () => [color(), color(), view.getUint8(offset++)]);
  const frames: Recording["frames"] = Array.from({ length: uint32() }, () => {
    let index = 0;
    return Array.from({ length: uint32() }, () => {
      index += view.getUint16(offset, true);
      const style = view.getUint32(offset + 2, true);
      const symbol = metadata.symbols[view.getUint16(offset + 6, true)];
      offset += 8;
      return [index, symbol, style];
    });
  });
  const { symbols, ...rest } = metadata;
  return { ...rest, styles, frames };
}
