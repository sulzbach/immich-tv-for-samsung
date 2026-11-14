// Removes the audio tracks from a QuickTime (.mov) or MP4 file held in
// memory, leaving its video and metadata tracks as they are.
//
// Ambient mode plays a Live Photo's motion, which Immich serves as the
// iPhone's original .mov (HEVC with PCM audio) when its transcoding policy
// leaves it untouched. On a Tizen 8.0 TV that file was heard although the
// <video> was muted at volume 0 and its audio track disabled, so the only
// reliable silence is a file with no audio track (ADR 0019).
//
// Both formats are ISO base media: nested boxes of a 32-bit big-endian size
// and a four-character type. A track (`trak`, in `moov`) is audio when its
// media handler (`moov/trak/mdia/hdlr`) has the type `soun` (QuickTime puts
// the same four bytes in its component subtype). Removing those tracks
// shrinks `moov`; when `moov` comes before the media data (`mdat`), every
// chunk offset in the remaining tracks (`stco`, `co64`) moves back by the
// bytes removed. The audio samples stay in `mdat`, unreferenced.

type Box = { end: number; headerSize: number; start: number; type: string };

// The file with its audio tracks removed, the same buffer when it has none,
// or null when it isn't a file this can read safely.
export function removeAudioTracks(buffer: ArrayBuffer): ArrayBuffer | null {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const top = readBoxes(view, 0, bytes.length);

  if (!top) {
    return null;
  }

  const moov = top.filter((box) => box.type === "moov");

  if (moov.length !== 1 || moov[0]!.headerSize !== 8) {
    return null;
  }

  const movie = moov[0]!;
  const children = readBoxes(view, movie.start + movie.headerSize, movie.end);

  if (!children) {
    return null;
  }

  const audio = children.filter((box) => box.type === "trak" && isAudioTrack(view, box));

  if (audio.length === 0) {
    return buffer;
  }

  const removed = audio.reduce((total, box) => total + (box.end - box.start), 0);
  const kept = children.filter((box) => audio.indexOf(box) < 0);
  const mediaAfterMovie = top.some(
    (box) => (box.type === "mdat" || box.type === "free") && box.start > movie.start
  );
  const output = new Uint8Array(bytes.length - removed);
  let at = 0;
  const copy = (from: number, to: number) => {
    output.set(bytes.subarray(from, to), at);
    at += to - from;
  };

  copy(0, movie.start);
  const movieStart = at;
  copy(movie.start, movie.start + movie.headerSize);
  kept.forEach((box) => copy(box.start, box.end));
  copy(movie.end, bytes.length);

  const outputView = new DataView(output.buffer);

  outputView.setUint32(movieStart, movie.end - movie.start - removed);

  if (mediaAfterMovie && !shiftChunkOffsets(outputView, movieStart, removed)) {
    return null;
  }

  return output.buffer;
}

function readBoxes(view: DataView, from: number, to: number): Box[] | null {
  const boxes: Box[] = [];
  let at = from;

  while (at + 8 <= to) {
    let size = view.getUint32(at);
    let headerSize = 8;

    if (size === 1) {
      if (at + 16 > to || view.getUint32(at + 8) !== 0) {
        return null;
      }

      size = view.getUint32(at + 12);
      headerSize = 16;
    } else if (size === 0) {
      size = to - at;
    }

    if (size < headerSize || at + size > to) {
      return null;
    }

    boxes.push({ end: at + size, headerSize, start: at, type: readType(view, at + 4) });
    at += size;
  }

  return at === to ? boxes : null;
}

function readType(view: DataView, at: number): string {
  let type = "";

  for (let index = 0; index < 4; index += 1) {
    type += String.fromCharCode(view.getUint8(at + index));
  }

  return type;
}

function child(view: DataView, parent: Box, type: string): Box | null {
  const boxes = readBoxes(view, parent.start + parent.headerSize, parent.end);

  return (boxes && boxes.filter((box) => box.type === type)[0]) || null;
}

// hdlr: version and flags (4), pre-defined or component type (4), then the
// handler type or component subtype (4).
function isAudioTrack(view: DataView, track: Box): boolean {
  const media = child(view, track, "mdia");
  const handler = media && child(view, media, "hdlr");

  if (!handler || handler.end - handler.start < handler.headerSize + 12) {
    return false;
  }

  return readType(view, handler.start + handler.headerSize + 8) === "soun";
}

// Moves every chunk offset in the movie back by `removed` bytes.
function shiftChunkOffsets(view: DataView, movieStart: number, removed: number): boolean {
  const movie: Box = {
    end: movieStart + view.getUint32(movieStart),
    headerSize: 8,
    start: movieStart,
    type: "moov"
  };
  const tracks = readBoxes(view, movie.start + movie.headerSize, movie.end);

  if (!tracks) {
    return false;
  }

  return tracks
    .filter((box) => box.type === "trak")
    .every((track) => {
      const media = child(view, track, "mdia");
      const info = media && child(view, media, "minf");
      const table = info && child(view, info, "stbl");

      if (!table) {
        return true;
      }

      const offsets32 = child(view, table, "stco");
      const offsets64 = child(view, table, "co64");

      return (
        (!offsets32 || shiftOffsets(view, offsets32, 4, removed)) &&
        (!offsets64 || shiftOffsets(view, offsets64, 8, removed))
      );
    });
}

// stco/co64: version and flags (4), entry count (4), then the offsets.
function shiftOffsets(view: DataView, box: Box, width: 4 | 8, removed: number): boolean {
  const first = box.start + box.headerSize + 8;
  const count = view.getUint32(box.start + box.headerSize + 4);

  if (first + count * width > box.end) {
    return false;
  }

  for (let index = 0; index < count; index += 1) {
    const at = first + index * width;

    if (width === 4) {
      view.setUint32(at, view.getUint32(at) - removed);
    } else {
      // Offsets in a file held in memory fit in the low 32 bits.
      if (view.getUint32(at) !== 0) {
        return false;
      }

      view.setUint32(at + 4, view.getUint32(at + 4) - removed);
    }
  }

  return true;
}
