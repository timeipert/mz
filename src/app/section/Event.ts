import * as VM from '../types/model';
import { CommonEvent } from '../types/CommonEvent';
import { ViewIiifRequested, HighlightRegionRequested } from '../notes/Request';

export type Event =
  CommonEvent |
  NewNoteLineRequsted |
  NewParatextRequested |
  NewFormteilRequested |
  MoveRequested |
  NoFocusRequested |
  NewCommentRequested |
  StaleCommentRemovealRequested |
  PasteRequested |
  ViewIiifRequested |
  HighlightRegionRequested;

export interface NewNoteLineRequsted {
  kind: "NewNoteLineRequsted";
  container: VM.ZeileContainer;
}

export interface NewParatextRequested {
  kind: "NewParatextRequested";
}

export interface NewFormteilRequested {
  kind: "NewFormteilRequested";
}

export interface MoveRequested {
  kind: "MoveRequested";
  from: number[];
  to: number[];
}

export interface NoFocusRequested {
  kind: "NoFocusRequested";
}

export interface NewCommentRequested {
  kind: "NewCommentRequested";
  startUUID: string;
  endUUID: string;
  text: string;
}

export interface StaleCommentRemovealRequested {
  kind: "StaleCommentRemovealRequested";
}

export interface PasteRequested {
  kind: "PasteRequested";
  at: number[];
  withoutNotes: boolean;
  withoutText: boolean;
}
