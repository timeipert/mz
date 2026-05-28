import { Injectable } from '@angular/core';
import { Focus } from './types/Focus';
import * as VM from './types/model';

@Injectable({
  providedIn: 'root'
})
export class FocusService {
  private lastFocus: (() => void) | undefined = undefined;

  registerFocus(callback: () => void): void {
    if (this.lastFocus) {
      try {
        this.lastFocus();
      } catch (e) {
        console.log(e);
      }
    }

    this.lastFocus = callback;
  }

  mode: Mode = { kind: "Normal" }

  preferredFocus: Focus = Focus.Notes;
  preferredVoiceIndex: number = 0;
  
  lastPitch?: { base: VM.BaseNote, octave: number };
}

type Mode = NormalMode | CommentCreateMode

export interface NormalMode {
  kind: "Normal";
}

export interface CommentCreateMode {
  kind: "CommentCreate";
  startNoteUUID: string;
}
