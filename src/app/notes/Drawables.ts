import { Comment, Spaced, NonSpaced, Grouped, Note, BaseNote, baseNotes, comparePositions } from '../types/model';
import { flatten, maxOf } from '../../utils';

export type Drawable = DNote | DTie | DCommentEnd | DCommentStart | DHelperLine
export type Ref = Note | Grouped

export class DNote {
  constructor(public x: number, public y: number, public ref: Note) { }

  addOffset(x: number): DNote { return new DNote(this.x + x, this.y, this.ref); }
}

export class DTie {
  constructor(public x: number, public y: number, public ref: Grouped, public width: number) { }

  addOffset(x: number): DTie { return new DTie(this.x + x, this.y, this.ref, this.width); }
  getPath(): string {
    return "M" + this.x + " " + this.y + " c -2 -8, " + (this.width - 3) + " -8, " + (this.width - 5) + " 0 ";
  }
}

export class DCommentStart {
  constructor(public x: number, public y: number, public ref: Note, public text: String) { }
  addOffset(x: number): DCommentStart { return new DCommentStart(this.x + x, this.y, this.ref, this.text); }
}

export class DCommentEnd {
  constructor(public x: number, public y: number, public ref: Note, public text: String) { }
  addOffset(x: number): DCommentEnd { return new DCommentEnd(this.x + x, this.y, this.ref, this.text); }
}

export class DHelperLine {
  constructor(public x: number, public y: number, public ref: Note) { }
  addOffset(x: number): DHelperLine { return new DHelperLine(this.x + x, this.y, this.ref); }
}

export function fromSpaced(sd: Spaced, comments: Comment[]): Drawable[] {
  const mapped = sd.spaced.map(x => fromNonSpaced(x, comments));
  return flatten(spacedWith(35, mapped));
}

function fromNonSpaced(ns: NonSpaced, comments: Comment[]): Drawable[] {
  const mapped = ns.nonSpaced.map(x => fromGrouped(x, comments));
  return flatten(spacedWith(17, mapped));
}

function fromGrouped(g: Grouped, comments: Comment[]): Drawable[] {
  const mapped = g.grouped.map(x => fromNote(x, comments));
  const notes: Drawable[] = flatten(spacedWith(16, mapped));
  if (g.grouped.length > 1) {
    notes.push(new DTie(
      2,
      -(maxOf(notes.map(n => -n.y - 20)) || 0),
      g,
      getWidth(notes) + 12
    ));
  }
  return notes;
}

function fromNote(n: Note, comments: Comment[]): Drawable[] {
  let ret: Drawable[] = [];
  let xOffset = 0;

  if (comparePositions(n.octave, n.base, 4, BaseNote.C) <= 0) {
    ret.push(new DHelperLine(0, 90, n));
  }

  if (comparePositions(n.octave, n.base, 3, BaseNote.A) <= 0) {
    ret.push(new DHelperLine(0, 100, n));
  }

  if (comparePositions(n.octave, n.base, 3, BaseNote.F) <= 0) {
    ret.push(new DHelperLine(0, 110, n));
  }

  if (comparePositions(n.octave, n.base, 5, BaseNote.A) >= 0) {
    ret.push(new DHelperLine(0, 30, n));
  }

  if (comparePositions(n.octave, n.base, 6, BaseNote.C) >= 0) {
    ret.push(new DHelperLine(0, 20, n));
  }

  //ret.push(new DNote(xOffset + 5, 92 - ((n.octave - 4) * 35) - baseNotes.indexOf(n.base) * 5, n));
  if (n.liquescent) {
    ret.push(new DNote(0, 60 - ((n.octave - 4) * 35) - baseNotes.indexOf(n.base) * 5 + 10, n));
  } else {
    ret.push(new DNote(-1, 60 - ((n.octave - 4) * 35) - baseNotes.indexOf(n.base) * 5, n));
  }
  const startComment = comments.find(c => c.startUUID === n.uuid);
  const endComment = comments.find(c => c.endUUID === n.uuid);

  if (startComment) {
    ret.push(new DCommentStart(xOffset - 5, 92 - ((n.octave - 4) * 35) - baseNotes.indexOf(n.base) * 5 - 7, n, startComment.text));
  }
  if (endComment) {
    ret.push(new DCommentEnd(xOffset + 11, 92 - ((n.octave - 4) * 35) - baseNotes.indexOf(n.base) * 5 - 7, n, endComment.text));
  }
  return ret;
}

function spacedWith(space: number, dss: Drawable[][]): Drawable[][] {
  const ret: Drawable[][] = [];

  let offset = 0;
  for (const ds of dss) {
    const width = getWidth(ds);
    ret.push(ds.map(d => d.addOffset(offset)));
    offset += space + width;
  }

  return ret;
}

function getWidth(ds: Drawable[]): number {
  let max = maxOf(ds.map(d => d.x));

  return max || 0;
}
