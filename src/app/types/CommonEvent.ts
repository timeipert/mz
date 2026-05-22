import { FocusChange } from './Focus';
import { Observer } from 'rxjs';
import * as VM from '../types/model';

export type CommonEvent =
  DeletionRequested |
  FocusShiftRequested |
  NoFocusRequested |
  CommentDeletionRequested |
  ResolveCommentSpansRequested |
  LineFocusShiftRequest;

export interface LineFocusShiftRequest {
  kind: "LineFocusShiftRequest";
  uuid: string;
  direction: number;
}

export interface FocusShiftRequested {
  kind: "FocusShiftRequested";
  change: FocusChange;
  direction: number;
}

export interface NoFocusRequested {
  kind: "NoFocusRequested";
}

export interface DeletionRequested {
  kind: "DeletionRequested";
  focusLast: boolean;
}

export interface ResolveCommentSpansRequested {
  kind: "ResolveCommentSpansRequested";
  spans: VM.Comment[];
  onResolve: Observer<VM.ZeileContainer[]>;
}


export interface CommentDeletionRequested {
  kind: "CommentDeletionRequested";
  comment: VM.Comment;
}
