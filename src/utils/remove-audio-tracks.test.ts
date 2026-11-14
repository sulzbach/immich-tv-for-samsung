import { describe, expect, it } from "vitest";
import { removeAudioTracks } from "./remove-audio-tracks";

// Builders for small ISO base media files: box(type, ...children or bytes).
function box(type: string, ...parts: Uint8Array[]): Uint8Array {
  const size = 8 + parts.reduce((total, part) => total + part.length, 0);
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);

  view.setUint32(0, size);
  for (let index = 0; index < 4; index += 1) {
    out[4 + index] = type.charCodeAt(index);
  }

  let at = 8;
  parts.forEach((part) => {
    out.set(part, at);
    at += part.length;
  });
  return out;
}

function bytes(...values: number[]): Uint8Array {
  return new Uint8Array(values);
}

function u32(value: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value);
  return out;
}

function text(value: string): Uint8Array {
  return new Uint8Array(value.split("").map((c) => c.charCodeAt(0)));
}

// hdlr: version/flags, component type (QuickTime "mhlr", MP4 zero), subtype.
function handler(kind: string, quickTime = true): Uint8Array {
  return box("hdlr", u32(0), quickTime ? text("mhlr") : u32(0), text(kind), u32(0), u32(0), u32(0));
}

function track(kind: string, offsets: number[], quickTime = true): Uint8Array {
  const stco = box("stco", u32(0), u32(offsets.length), ...offsets.map(u32));

  return box(
    "trak",
    box("tkhd", u32(0)),
    box("mdia", box("mdhd", u32(0)), handler(kind, quickTime), box("minf", box("stbl", stco)))
  );
}

function file(...parts: Uint8Array[]): ArrayBuffer {
  const all = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let at = 0;
  parts.forEach((part) => {
    all.set(part, at);
    at += part.length;
  });
  return all.buffer;
}

// Every track's handler type and chunk offsets, in order.
function describeTracks(buffer: ArrayBuffer): { kind: string; offsets: number[] }[] {
  const data = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const tracks: { kind: string; offsets: number[] }[] = [];
  const find = (from: number, to: number, type: string) => {
    for (let at = from; at + 8 <= to; at += view.getUint32(at)) {
      if (String.fromCharCode(...data.subarray(at + 4, at + 8)) === type) {
        return at;
      }
    }
    return -1;
  };
  const end = (at: number) => at + view.getUint32(at);
  const moov = find(0, data.length, "moov");

  for (let at = moov + 8; at < end(moov); at = end(at)) {
    if (String.fromCharCode(...data.subarray(at + 4, at + 8)) !== "trak") {
      continue;
    }
    const mdia = find(at + 8, end(at), "mdia");
    const hdlr = find(mdia + 8, end(mdia), "hdlr");
    const stbl = find(find(mdia + 8, end(mdia), "minf") + 8, end(mdia), "stbl");
    const stco = find(stbl + 8, end(stbl), "stco");
    const count = view.getUint32(stco + 12);
    const offsets: number[] = [];
    for (let index = 0; index < count; index += 1) {
      offsets.push(view.getUint32(stco + 16 + index * 4));
    }
    tracks.push({ kind: String.fromCharCode(...data.subarray(hdlr + 16, hdlr + 20)), offsets });
  }
  return tracks;
}

describe("removing audio tracks", () => {
  it("drops the audio track of a QuickTime file whose movie box comes last", () => {
    const mdat = box("mdat", bytes(1, 2, 3, 4, 5, 6, 7, 8));
    const ftyp = box("ftyp", text("qt  "), u32(0));
    const input = file(
      ftyp,
      mdat,
      box(
        "moov",
        box("mvhd", u32(0)),
        track("vide", [24]),
        track("soun", [28]),
        track("meta", [30])
      )
    );

    const output = removeAudioTracks(input)!;

    expect(describeTracks(output)).toEqual([
      { kind: "vide", offsets: [24] },
      { kind: "meta", offsets: [30] }
    ]);
    expect(output.byteLength).toBe(input.byteLength - track("soun", [28]).length);
    // The media data is untouched.
    expect(Array.from(new Uint8Array(output, ftyp.length, mdat.length))).toEqual(Array.from(mdat));
  });

  it("moves the chunk offsets back when the movie box comes before the media", () => {
    const audio = track("soun", [200], false);
    const input = file(
      box("ftyp", text("isom"), u32(0)),
      box("moov", box("mvhd", u32(0)), track("vide", [300, 340], false), audio),
      box("mdat", new Uint8Array(64))
    );

    const output = removeAudioTracks(input)!;

    expect(describeTracks(output)).toEqual([
      { kind: "vide", offsets: [300 - audio.length, 340 - audio.length] }
    ]);
  });

  it("returns the same file when it has no audio", () => {
    const input = file(box("ftyp", u32(0)), box("moov", track("vide", [0])), box("mdat", u32(0)));

    expect(removeAudioTracks(input)).toBe(input);
  });

  it("gives up on a file it can't read safely", () => {
    // A box claiming to be larger than the file.
    const broken = new Uint8Array(file(box("ftyp", u32(0)), box("moov", track("soun", [0]))));
    new DataView(broken.buffer).setUint32(0, 9999);

    expect(removeAudioTracks(broken.buffer)).toBeNull();
    expect(removeAudioTracks(file(box("ftyp", u32(0))))).toBeNull();
    expect(removeAudioTracks(new ArrayBuffer(3))).toBeNull();
  });
});
