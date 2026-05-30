import {
  ChangeDetectorRef, Component, OnInit, QueryList, ViewChildren,
  OnDestroy, ChangeDetectionStrategy, ElementRef, ViewChild, Output, Input, EventEmitter, AfterViewInit, HostListener
} from '@angular/core';
import * as VM from '../types/model';
import { fromSpaced, fromSpaceds, Drawable, DNote, DTie, DCommentStart, DCommentEnd, DHelperLine } from './Drawables';
import { ToolsService } from '../tools.service';
import { musicLanguage } from './language';
import { assertNever, maxOf, textWidth, focusContentEditable } from '../../utils';
import { ToastrService } from 'ngx-toastr';
import * as R from './Request';
import { v4 as UUID } from "uuid";
import { FocusService } from '../focus.service';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { handleTextInputMove, Focusable, Focus, FocusChange } from '../types/Focus';
import { CommentComponent } from '../comment/comment.component';
import { ReplaySubject, Subscription } from 'rxjs';
import { UndoService } from '../undoService';

declare const $: any;

@Component({
  selector: 'app-notes',
  templateUrl: './notes.component.html',
  styleUrls: ['./notes.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class NotesComponent implements OnDestroy, OnInit, Focusable, AfterViewInit {
  @ViewChildren('noteText') noteTextElements!: QueryList<ElementRef>;
  @ViewChild('syllableText', { static: true }) syllableTextElement!: ElementRef;
  @ViewChildren('notesDiv') notesDivElements!: QueryList<ElementRef>;
  @ViewChild('commentModal', { static: true }) commentModal!: ElementRef;

  @Input()
  readOnly!: boolean;

  @Input()
  comments!: VM.Comment[];

  @Output()
  request = new EventEmitter<R.Request>();

  @Input()
  model!: VM.Syllable;

  syllableWidth = 0;
  noteTextWidth = 0;
  syllTextWidth = 0;
  svgWidth = 0;
  hasFocus: boolean[] = [];
  focusedVoiceIndex = 0;
  timeoutF: any = undefined;
  drawablesCache: Drawable[][] = [];
  lastModelString = '';

  getVoices(): VM.Spaced[] {
    const voices = [this.model.notes];
    if (this.model.additionalMelodies) {
      voices.push(...this.model.additionalMelodies);
    }
    return voices;
  }

  getActiveComments(): VM.Comment[] {
    const focusedNote = VM.getFocused(this.getVoices()[this.focusedVoiceIndex]);
    if (focusedNote) {
      return this.comments.filter(c => c.endUUID === focusedNote.uuid || c.startUUID === focusedNote.uuid);
    }
    return [];
  }

  getSyllableComments(): VM.Comment[] {
    if (this.model.uuid) {
      return this.comments.filter(c => c.endUUID === this.model.uuid || c.startUUID === this.model.uuid);
    }
    return [];
  }

  constructor(
    private focusService: FocusService,
    private cdr: ChangeDetectorRef,
    private toastr: ToastrService,
    private domRoot: ElementRef,
    private toolsService: ToolsService,
    private undoService: UndoService,
    private modalService: NgbModal) {
  }

  refresh() { this.cdr.detectChanges(); this.notesToText(); }

  ngOnInit() {
    this.notesToText();
    (this.syllableTextElement.nativeElement as HTMLElement).textContent = this.model.text;
    this.recalculateWidths();
  }

  ngAfterViewInit() {
    // Populate contenteditable fields now that ViewChildren are available
    // (ngOnInit runs before ViewChildren are resolved, so we must do it here)
    setTimeout(() => this.notesToText(), 0);
    this.noteTextElements.changes.subscribe(() => {
      setTimeout(() => this.notesToText(), 0);
    });
    // Re-render this OnPush component whenever the globally-selected note
    // changes, so palette-coloured brackets in this syllable can light up
    // (or fade back to gray) without depending on local focus.
    this.focusedNoteSub = this.focusService.focusedNoteUUID$.subscribe(() => {
      this.cdr.markForCheck();
    });
  }

  private focusedNoteSub?: Subscription;

  @HostListener('window:focus')
  onWindowFocus() {
    // When the user returns from another app, Angular CD may have cleared the
    // imperatively-managed contenteditable textContent. Re-sync from model.
    setTimeout(() => this.notesToText(), 0);
  }

  undoCallback = async () => {
    setTimeout(() => {
      this.notesToText();
      (this.syllableTextElement.nativeElement as HTMLElement).textContent = this.model.text;
      this.recalculateWidths();
      this.cdr.detectChanges();
    }, 5);
  }

  ngOnDestroy() {
    this.undoService.deregisterNotesCallbacks(this.model.uuid);
    this.focusedNoteSub?.unsubscribe();
    setTimeout(() => this.toolsService.remove(this), 0);
  }

  requestDeleteComment(c: VM.Comment): void {
    this.request.emit({ kind: 'CommentDeletionRequested', comment: c });
  }

  hasCurrentFocus(d: Drawable, voiceIndex: number) {
    return this.hasFocus[voiceIndex] && (d.ref as any).focus;
  }

  setDivFocus(focus: boolean, voiceIndex: number) {
    this.hasFocus[voiceIndex] = focus;
    this.focusedVoiceIndex = voiceIndex;
    if (focus) {
      this.focusService.preferredVoiceIndex = voiceIndex;
      // Re-sync contenteditable from model after Angular CD may have cleared it
      // (happens when browser window loses and regains focus)
      setTimeout(() => this.notesToText(), 0);
    }
    const notes = this.getVoices()[voiceIndex];
    if (focus && (VM.getFocused(notes) || this.model.syllableType !== VM.SyllableType.Normal)) {
      this.addNoteTools();
    } else {
      // Discard latent notes on blur
      if (!focus) {
        const focusedNote = VM.getFocused(notes);
        if (focusedNote && focusedNote.isLatent) {
           this.discardLatentNote(voiceIndex);
        }
      }
      this.timeoutF = setTimeout(() => this.toolsService.remove(this), 200);
    }
  }

  discardLatentNote(voiceIndex: number) {
    if (voiceIndex === 0) {
      this.model.notes.spaced = [];
    } else {
      if (this.model.additionalMelodies) {
         this.model.additionalMelodies[voiceIndex - 1].spaced = [];
      }
    }
    this.notesToText();
    this.recalculateWidths();
    this.cdr.markForCheck();
    this.cdr.detectChanges();
  }

  focus(change: FocusChange): void {
    const level = change.preferredLevel || this.focusService.preferredFocus;
    this.focusedVoiceIndex = this.focusService.preferredVoiceIndex || 0;
    
    // Safety check: if preferredVoiceIndex is out of bounds, reset to 0
    if (this.focusedVoiceIndex >= this.getVoices().length) {
        this.focusedVoiceIndex = 0;
    }
    
    switch (level) {
      case Focus.Notes:
        const voice = this.getVoices()[this.focusedVoiceIndex];
        if (voice.spaced.length === 0 || (voice.spaced.length > 0 && voice.spaced[0].nonSpaced.length === 0) || (voice.spaced.length > 0 && voice.spaced[0].nonSpaced.length > 0 && voice.spaced[0].nonSpaced[0].grouped.length === 0)) {
          // If moving right (+1) into empty syllable, or we just want to focus it, create latent note
          if (!change.focusLast) {
              const emptyNotes = JSON.parse(JSON.stringify(VM.emptySyllable().notes));
              const newNote = emptyNotes.spaced[0].nonSpaced[0].grouped[0];
              if (this.focusService.lastPitch) {
                newNote.base = this.focusService.lastPitch.base;
                newNote.octave = this.focusService.lastPitch.octave;
              } else {
                newNote.base = VM.BaseNote.C;
                newNote.octave = 4;
              }
              newNote.isLatent = true;
              newNote.focus = true;
              if (this.focusedVoiceIndex === 0) {
                this.model.notes = emptyNotes;
              } else {
                if (!this.model.additionalMelodies) this.model.additionalMelodies = [];
                this.model.additionalMelodies[this.focusedVoiceIndex - 1] = emptyNotes;
              }
              this.notesToText();
              this.recalculateWidths();
              this.cdr.markForCheck();
              if (this.notesDivElements) {
                setTimeout(() => {
                  (this.notesDivElements.toArray()[this.focusedVoiceIndex].nativeElement as HTMLElement).focus();
                }, 0);
              }
          } else {
             this.requestFocusShift(level, change.focusLast, -1);
          }
        } else {
          if (change.focusLast) { this.focusLast(); } else { this.focusFirst(); }
        }
        break;
      case Focus.Code:
        this.focusService.registerFocus(() => { VM.removeFocusFromLinePart(this.model); this.cdr.markForCheck(); });
        focusContentEditable(this.noteTextElements.toArray()[this.focusedVoiceIndex].nativeElement as HTMLElement, change.focusLast);
        break;
      case Focus.Text:
        this.focusService.registerFocus(() => { VM.removeFocusFromLinePart(this.model); this.cdr.markForCheck(); });
        focusContentEditable(this.syllableTextElement.nativeElement as HTMLElement, change.focusLast);
        break;
      default: assertNever(level);
    }
  }

  getData(): any {
    return this.model;
  }

  private focusFirst(): void {
    VM.focusFirst(this.getVoices()[this.focusedVoiceIndex]);
    if (this.notesDivElements) {
        (this.notesDivElements.toArray()[this.focusedVoiceIndex].nativeElement as HTMLElement).focus();
    }
  }

  private focusLast(): void {
    VM.focusLast(this.getVoices()[this.focusedVoiceIndex]);
    if (this.notesDivElements) {
        (this.notesDivElements.toArray()[this.focusedVoiceIndex].nativeElement as HTMLElement).focus();
    }
  }

  changeNoteText(event: KeyboardEvent, voiceIndex: number) {
    this.focusedVoiceIndex = voiceIndex;
    const voices = this.getVoices();
    const oldNoteText = spacedToString(voices[voiceIndex]);
    const el = this.noteTextElements.toArray()[voiceIndex].nativeElement as HTMLElement;
    const newNoteText = el.textContent || '';
    //Do not call function if nothing changes thus adding empty changes to undoService
    if (oldNoteText !== newNoteText) {
      this.undoService.beforeChange('Edit Note');
      this.undoService.registerNotesCallbacks(this.model.uuid, this.undoCallback)
      event.stopPropagation();
      event.preventDefault();
      this.textToNotes(voiceIndex);
      this.recalculateWidths();
    }
  }

  private showComments(syllable: boolean) {
    const rp = new ReplaySubject<VM.ZeileContainer[]>(1);
    let comments: VM.Comment[] = [];
    if (syllable) {
      comments = this.getSyllableComments();
    } else {
      comments = this.getActiveComments();
    }
    rp.subscribe(originals => {
      // Use the same modal options as document.openComment() for a
      // consistent look-and-feel across every route into the comment dialog.
      const modalRef = this.modalService.open(CommentComponent, { size: 'xl', centered: true, backdrop: 'static', windowClass: 'comment-modal-window', fullscreen: 'lg' });
      modalRef.componentInstance.comments = JSON.parse(JSON.stringify(comments));
      modalRef.componentInstance.originals = JSON.parse(JSON.stringify(originals));
      modalRef.componentInstance.saveEvent.subscribe((newComments: (VM.Comment | null)[]) => {
        for (let i = 0; i < newComments.length; i++) {
          const nc = newComments[i];
          if (nc === null) {
            this.request.emit({ kind: 'CommentDeletionRequested', comment: comments[i] });
          } else {
            comments[i].emendation = nc.emendation;
            comments[i].lines = nc.lines;
            comments[i].tree = nc.tree;
            comments[i].text = nc.text;
          }
        }
      });
    });
    this.request.emit({
      kind: 'ResolveCommentSpansRequested',
      onResolve: rp,
      spans: comments
    });
  }

  changeSyllableTextDown(event: KeyboardEvent) {

    const textBefore = (this.syllableTextElement.nativeElement as HTMLElement).textContent || '';
    if (event.key === 'Enter') {
      event.stopPropagation();
      event.preventDefault();
      this.request.emit({ kind: 'NewLineRequested' });
    } else if (event.key === ' ') {
      event.stopPropagation();
      event.preventDefault();
      this.request.emit({ kind: 'NewSegmentRequested', syllableType: this.model.syllableType, text: '' });
    } else if (event.key === 'Backspace' && textBefore === '') {
      event.stopPropagation();
      event.preventDefault();
      this.request.emit({ kind: 'DeletionRequested', focusLast: true });
    }

    handleTextInputMove(this.syllableTextElement.nativeElement, event, e => this.request.emit(e));

    if (event.key === 'ArrowUp') {
      this.undoService.beforeChange('Edit Note');
      this.undoService.registerNotesCallbacks(this.model.uuid, this.undoCallback)
      event.preventDefault();
      this.focusService.preferredFocus = Focus.Code;
      this.focusedVoiceIndex = this.getVoices().length - 1; // bottom-most voice
      this.focus({ focusLast: false });
    }
    if (event.ctrlKey && event.key === 'z') {
      event.stopPropagation();
      event.preventDefault();
      this.undoService.undo();
    }
  }

  onNoteTextDown(event: KeyboardEvent, voiceIndex: number): void {
    this.focusedVoiceIndex = voiceIndex;
    const el = this.noteTextElements.toArray()[voiceIndex].nativeElement as HTMLElement;
    handleTextInputMove(el, event, e => this.request.emit(e));
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (this.focusedVoiceIndex < this.getVoices().length - 1) {
         this.focusedVoiceIndex++;
         this.focusService.preferredFocus = Focus.Code;
         this.focus({ focusLast: false });
      } else {
         this.focusService.preferredFocus = Focus.Text;
         this.focus({ focusLast: false });
         focusContentEditable(this.syllableTextElement.nativeElement, 2);
      }
    }
    if (event.key === 'ArrowUp') {
      if (this.focusedVoiceIndex > 0) {
         event.preventDefault();
         this.focusedVoiceIndex--;
         this.focusService.preferredFocus = Focus.Code;
         this.focus({ focusLast: false });
      }
    }
    if (event.ctrlKey && event.key === 'z') {
      event.stopPropagation();
      event.preventDefault();
      this.undoService.undo();
    }
  }

  splitAndCreateNewSegments(text: string): boolean {
    let newTextSegments: string[] = [];
    if (text) {
      newTextSegments = text.split(/(?=\-)/);
      newTextSegments.map((t, i) => {
        if (i < newTextSegments.length - 1) {
          if (newTextSegments[i + 1].indexOf("-") === 0) {
            newTextSegments[i] = t + "-";
            newTextSegments[i + 1] = newTextSegments[i + 1].replace("-", "");
          }
        }
      })
      newTextSegments = newTextSegments.filter(t => t.length > 0)
      if (newTextSegments.length > 1) {
        for (let i = newTextSegments.length - 1; i > 0; i--) {
          this.request.emit({ kind: 'NewSegmentRequested', syllableType: this.model.syllableType, text: newTextSegments[i] });
        }
        const thisNewText = newTextSegments[0];
        (this.syllableTextElement.nativeElement as HTMLElement).textContent = thisNewText;
        this.model.text = thisNewText;
        return true;
      }
    }
    return false;
  }

  pasteSyllableText(e: ClipboardEvent) {
    e.stopPropagation();
    e.preventDefault();
    if (e.clipboardData) {
      this.undoService.beforeChange('Edit Note');
      this.undoService.registerNotesCallbacks(this.model.uuid, this.undoCallback)
      const text = e.clipboardData.getData('text');
      this.splitAndCreateNewSegments(text);
      this.recalculateWidths();
    }
  }

  changeSyllableText(e: KeyboardEvent) {
    e.stopPropagation();
    e.preventDefault();
    const oldText = this.model.text;
    const newText = (this.syllableTextElement.nativeElement as HTMLElement).textContent || '';

    if (oldText !== newText) {
      this.undoService.beforeChange('Edit Note');
      this.undoService.registerNotesCallbacks(this.model.uuid, this.undoCallback);
      if (e.key === '-') {
          e.stopPropagation();
          const text = (this.syllableTextElement.nativeElement as HTMLElement).textContent;
          if (text) {
            const splitOccurred = this.splitAndCreateNewSegments(text);
            if (!splitOccurred) {
              this.model.text = text;
            }
          }
        } else {
          const newContent = (this.syllableTextElement.nativeElement as HTMLElement).textContent || '';
          this.model.text = newContent;
        }
      }
    this.recalculateWidths();
  }

  clickOn(e: MouseEvent, voiceIndex: number): void {
    this.focusedVoiceIndex = voiceIndex;
    e.preventDefault();
    e.stopPropagation();
    const voices = this.getVoices();
    if (voices[voiceIndex].spaced[0].nonSpaced.length === 0) {
      this.undoService.beforeChange('Edit Note');
      this.undoService.registerNotesCallbacks(this.model.uuid, this.undoCallback);
      const emptyNotes = JSON.parse(JSON.stringify(VM.emptySyllable().notes));
      emptyNotes.spaced[0].nonSpaced[0].grouped[0] = this.getNoteByClickPos(e.offsetY);
      if (voiceIndex === 0) {
        this.model.notes = emptyNotes;
      } else {
        if (!this.model.additionalMelodies) this.model.additionalMelodies = [];
        this.model.additionalMelodies[voiceIndex - 1] = emptyNotes;
      }
      this.focus({ focusLast: true });
    } else {
      this.insertNoteNear(this.getNoteByClickPos(e.offsetY));
    }
    this.notesToText();
    this.recalculateWidths();
  }

  getNoteByClickPos(y: number): VM.Note {
    let newBase = VM.BaseNote.A;
    let newOctave = 4;
    if (y > 90) {
      newBase = VM.BaseNote.C;
      newOctave = 4;
    } else if (y <= 90 && y > 85) {
      newBase = VM.BaseNote.D;
    } else if (y <= 85 && y > 80) {
      newBase = VM.BaseNote.E;
    } else if (y <= 80 && y > 75) {
      newBase = VM.BaseNote.F;
    } else if (y <= 75 && y > 70) {
      newBase = VM.BaseNote.G;
    } else if (y <= 70 && y > 65) {
      newBase = VM.BaseNote.A;
    } else if (y <= 65 && y > 60) {
      newBase = VM.BaseNote.B;
    } else if (y <= 60 && y > 55) {
      newBase = VM.BaseNote.C;
      newOctave = 5;
    } else if (y <= 55 && y > 50) {
      newBase = VM.BaseNote.D;
      newOctave = 5;
    } else if (y <= 50 && y > 45) {
      newBase = VM.BaseNote.E;
      newOctave = 5;
    } else if (y <= 45 && y > 40) {
      newBase = VM.BaseNote.F;
      newOctave = 5;
    } else if (y <= 40 && y > 35) {
      newBase = VM.BaseNote.G;
      newOctave = 5;
    } else if (y <= 35) {
      newBase = VM.BaseNote.A;
      newOctave = 5;
    }

    return {
      uuid: UUID(),
      base: newBase,
      focus: true,
      liquescent: false,
      noteType: VM.NoteType.Normal,
      octave: newOctave
    };
  }

  switchVoice(delta: number): void {
    const newIndex = this.focusedVoiceIndex + delta;
    if (newIndex >= 0 && newIndex < this.getVoices().length) {
      // Unfocus current
      const focused = VM.getFocused(this.getVoices()[this.focusedVoiceIndex]);
      if (focused) focused.focus = false;

      // Update preferred voice
      this.focusedVoiceIndex = newIndex;
      this.focusService.preferredVoiceIndex = newIndex;

      // Focus the new voice's first note
      const notes = this.getVoices()[newIndex];
      const newFocus = VM.getFocused(notes);
      if (!newFocus && notes.spaced.length > 0 && notes.spaced[0].nonSpaced.length > 0 && notes.spaced[0].nonSpaced[0].grouped.length > 0) {
         notes.spaced[0].nonSpaced[0].grouped[0].focus = true;
      }
      this.notesToText();
      this.cdr.detectChanges();
    }
  }

  keyDown(e: KeyboardEvent, voiceIndex: number): void {
    this.focusedVoiceIndex = voiceIndex;
    this.focusService.preferredVoiceIndex = voiceIndex;
    e.preventDefault();
    e.stopPropagation();
    if (e.altKey && e.key === 'ArrowDown') { this.switchVoice(1); }
    else if (e.altKey && e.key === 'ArrowUp') { this.switchVoice(-1); }
    else if (e.key === 'ArrowUp') { this.changePitch(VM.nextNote); }
    else if (e.altKey && e.key === 't') { this.request.emit({ kind: 'EditSyllableTextReqested' }); }
    else if (e.altKey && e.key === 'n') { this.request.emit({ kind: 'EditNotesTextReqested' }); }
    else if (e.altKey && e.key === 'ArrowRight') { this.insertOrShiftRight(); }
    else if (e.altKey && e.key === 'ArrowLeft') { } //do nothing
    else if (e.altKey && e.key === 'Enter') { this.splitLine(); }
    else if (e.ctrlKey && e.key === '.') { this.request.emit({ kind: 'ChangeToBoxRequested' }); }
    else if (e.altKey && e.key === '.') { this.request.emit({ kind: 'ChangeToBoxRequested' }); }
    else if (e.key === 'ArrowDown') { this.changePitch(VM.previousNote); }
    else if (e.key === 'ArrowLeft') {
      const focused = VM.getFocused(this.getVoices()[this.focusedVoiceIndex]);
      if (focused && focused.isLatent) {
        this.discardLatentNote(this.focusedVoiceIndex);
        this.requestFocusShift(undefined, true, -1);
      } else {
        this.focusOther(VM.getLeftOf, () => this.requestFocusShift(undefined, true, -1));
      }
    }
    else if (e.key === 'ArrowRight') {
      const focused = VM.getFocused(this.getVoices()[this.focusedVoiceIndex]);
      if (focused && focused.isLatent) {
        delete focused.isLatent;
        this.notesToText();
        this.cdr.markForCheck();
      }
      this.focusOther(VM.getRightOf, () => this.requestFocusShift(undefined, false, +1));
    }
    else if (e.key === 's') { this.toggleNoteType(VM.NoteType.Sharp); }
    else if (e.key === 'n') { this.toggleNoteType(VM.NoteType.Natural); }
    else if (e.key === 'f') { this.toggleNoteType(VM.NoteType.Flat); }
    else if (e.key === 'o') { this.toggleNoteType(VM.NoteType.Oriscus); }
    else if (e.key === 'a') { this.toggleNoteType(VM.NoteType.Ascending); }
    else if (e.key === 'd') { this.toggleNoteType(VM.NoteType.Descending); }
    else if (e.key === ',') { this.toggleNoteType(VM.NoteType.Strophicus); }
    else if (e.key === 'q') { this.toggleNoteType(VM.NoteType.Quilisma); }
    else if (e.key === 'l') { this.toggleLiquescent(); }
    else if (e.key === 'Shift') { this.insertNoteSlur(); }
    else if (e.key === ' ') { this.insertNear(); }
    else if (e.key === 'Enter') { this.insertFar(); }
    else if (e.key === 'j') { this.request.emit({ kind: 'LineChangeRequested', after: true }); }
    else if (e.key === 'c') { this.request.emit({ kind: 'NewClefRequested' }); }
    else if (e.key === '-') { this.request.emit({ kind: 'NewSegmentRequested', syllableType: this.model.syllableType, text: '' }); }
    else if (e.key === 'i') { this.request.emit({ kind: 'LineChangeRequested', after: false }); }
    else if (e.key === 'Delete') { this.deleteNote(false); }
    else if (e.key === 'Backspace') { this.deleteNote(true); }
    else if (e.ctrlKey && e.key === 'z') {
      this.undoService.undo();
    }
    this.notesToText();
    this.recalculateWidths();
  }

  splitLine() {
    this.undoService.beforeChange('Edit Note');
    this.request.emit({ kind: 'SplitLineRequested' })
  }

  insertLinChangeInFront() {
    this.withPath((s, ns, gr, no) => {
      this.undoService.beforeChange('Edit Note');
      this.request.emit({ kind: 'LineChangeRequested', after: false });
    });
  }

  insertOrShiftRight() {
    this.withPath((s, ns, gr, no) => {
      this.undoService.beforeChange('Edit Note');
      this.request.emit({ kind: 'AddNoteToNextSegment', note: no });
    });
  }

  insertFar(): void {
    this.withPath((s, ns, gr, no) => {
      this.undoService.beforeChange('Edit Note');
      this.undoService.registerNotesCallbacks(this.model.uuid, this.undoCallback)
      const newNote = noteFromTemplate(no);
      this.insertNoteFar(newNote);
    });
  }

  insertNoteFar(note: VM.Note) {
    this.withPath((s, ns, gr, no) => {
      this.undoService.beforeChange('Edit Note');
      this.undoService.registerNotesCallbacks(this.model.uuid, this.undoCallback)
      no.focus = false;
      const notesBefore = gr.grouped.slice(0, gr.grouped.indexOf(no) + 1);
      const notesAfter = gr.grouped.slice(gr.grouped.indexOf(no) + 1);
      const newGroups: VM.Grouped[] = [];
      if (notesBefore.length > 0) newGroups.push({ grouped: notesBefore });
      const newGroup = { grouped: [note] };
      newGroups.push(newGroup);
      if (notesAfter.length > 0) newGroups.push({ grouped: notesAfter });
      ns.nonSpaced.splice(ns.nonSpaced.indexOf(gr), 1, ...newGroups);

      const groupsBefore = ns.nonSpaced.slice(0, ns.nonSpaced.indexOf(newGroup));
      const groupsAfter = ns.nonSpaced.slice(ns.nonSpaced.indexOf(newGroup) + 1);
      const newNonSpaceds: VM.NonSpaced[] = [];
      if (groupsBefore.length > 0) newNonSpaceds.push({ nonSpaced: groupsBefore });
      const newNonspaced = { nonSpaced: [newGroup] };
      newNonSpaceds.push(newNonspaced);
      if (groupsAfter.length > 0) newNonSpaceds.push({ nonSpaced: groupsAfter });
      s.spaced.splice(s.spaced.indexOf(ns), 1, ...newNonSpaceds);
    });
  }

  requestFocusShift(level: Focus | undefined, focusLast: boolean, direction: number) {
    this.request.emit({
      kind: 'FocusShiftRequested',
      change: {
        focusLast: focusLast,
        preferredLevel: level
      },
      direction: direction
    });
    this.withFocus(n => { n.focus = false; });
  }

  insertNear(): void {
    this.withPath((s, ns, gr, no) => {
      this.undoService.beforeChange('Edit Note');
      this.undoService.registerNotesCallbacks(this.model.uuid, this.undoCallback)
      const newNote = noteFromTemplate(no);
      this.insertNoteNear(newNote);
    });
  }

  insertNoteNear(note: VM.Note) {
    this.withPath((s, ns, gr, no) => {
      this.undoService.beforeChange('Edit Note');
      this.undoService.registerNotesCallbacks(this.model.uuid, this.undoCallback)
      no.focus = false;
      const notesBefore = gr.grouped.slice(0, gr.grouped.indexOf(no) + 1);
      const notesAfter = gr.grouped.slice(gr.grouped.indexOf(no) + 1);
      const newGroups: VM.Grouped[] = [];
      if (notesBefore.length > 0) newGroups.push({ grouped: notesBefore });
      newGroups.push({ grouped: [note] });
      if (notesAfter.length > 0) newGroups.push({ grouped: notesAfter });
      ns.nonSpaced.splice(ns.nonSpaced.indexOf(gr), 1, ...newGroups);
    });
  }

  insertNoteSlur(): void {
    this.withPath((s, ns, gr, no) => {
      this.undoService.beforeChange('Edit Note');
      this.undoService.registerNotesCallbacks(this.model.uuid, this.undoCallback)
      const newNote = noteFromTemplate(no);
      no.focus = false;

      gr.grouped.splice(gr.grouped.indexOf(no) + 1, 0, newNote);
    });
  }

  deleteNote(focusLast: boolean): void {
    if (this.getActiveComments().length > 0) {
      this.toastr.info('Bitte löschen Sie zunächst den Kommentar, bevor Sie das Symbol löschen');
    } else {
      const nextNote = this.withPath((s, ns, gr, no) => {
        this.undoService.beforeChange('Edit Note');
        this.undoService.registerNotesCallbacks(this.model.uuid, this.undoCallback)
        let nextNote = !focusLast ? VM.getRightOf(s, no) : VM.getLeftOf(s, no);
        gr.grouped.splice(gr.grouped.indexOf(no), 1);
        if (gr.grouped.length === 0) {
          const filteredNS = ns.nonSpaced.filter(function(e) {
            return e.grouped.length !== 0;
          });
          ns.nonSpaced = filteredNS;
          if (ns.nonSpaced.length === 0) {
            var filteredS = s.spaced.filter(function(e) {
              return e.nonSpaced.length !== 0;
            });
            s.spaced = filteredS;
          }
        }

        this.notesToText();
        if (nextNote !== undefined) {
          nextNote.focus = true;
        } else {
          if (s.spaced.length === 0) {
            // Do not delete the syllable! Just move focus.
            if (focusLast) {
               this.requestFocusShift(undefined, true, -1);
            } else {
               this.requestFocusShift(undefined, false, +1);
            }
          } else {
            this.requestFocusShift(undefined, focusLast, -1);
          }
        }

        return nextNote;
      });
    }
  }

  toggleLiquescent(): void {
    this.withFocus(f => f.liquescent = !f.liquescent);
  }

  toggleNoteType(t: VM.NoteType): void {
    this.withFocus(f => {
      if (f.noteType === t) {
        f.noteType = VM.NoteType.Normal;
      } else {
        f.noteType = t;
      }
    });
  }



  changePitch(producer: (n: VM.Note) => VM.Note): void {
    this.withFocus(f => {
      this.undoService.beforeChange('Edit Note');
      this.undoService.registerNotesCallbacks(this.model.uuid, this.undoCallback)
      if (f.isLatent) {
        delete f.isLatent;
      }
      const newNote = producer(f);
      f.octave = newNote.octave;
      f.base = newNote.base;
    });
  }

  focusOther(selector: (s: VM.Spaced, f: VM.Note) => VM.Note | undefined, notFoundAction: () => void): void {
    this.withOther(f => selector(this.getVoices()[this.focusedVoiceIndex], f), (focused, other) => {
      focused.focus = false;
      other.focus = true;
    }, notFoundAction);
  }


  withOther(selector: (f: VM.Note) => VM.Note | undefined, action: (f: VM.Note, o: VM.Note) => void, notFoundAction?: () => void): void {
    this.withFocus(focused => {
      const other = selector(focused);
      if (other === undefined) {
        if (notFoundAction) {
          notFoundAction();
        }
      } else {
        action(focused, other);
      }
    });
  }

  withPath<A>(f: (s: VM.Spaced, ns: VM.NonSpaced, gr: VM.Grouped, no: VM.Note) => A): A | undefined {
    const path = VM.getFocusedPath(this.getVoices()[this.focusedVoiceIndex]);
    if (path !== undefined) {
      const [s, ns, gr, no] = path;
      return f(s, ns, gr, no);
    }
  }

  withFocus(f: (focused: VM.Note) => void): void {
    const focused = VM.getFocused(this.getVoices()[this.focusedVoiceIndex]);
    if (focused) {
      if (!focused.isLatent) {
        this.focusService.lastPitch = { base: focused.base, octave: focused.octave };
      }
      f(focused);
    }
  }

  getDrawables(voiceIndex: number): Drawable[] {
    const newModelString = JSON.stringify([this.model, this.comments]);
    if (this.lastModelString === newModelString) {
      return this.drawablesCache[voiceIndex] || [];
    } else {
      this.lastModelString = newModelString;
      this.drawablesCache = fromSpaceds(this.getVoices(), this.comments);
      return this.drawablesCache[voiceIndex] || [];
    }
  }

  textToNotes(voiceIndex: number): void {
    const el = this.noteTextElements.toArray()[voiceIndex].nativeElement as HTMLElement;
    const text = el.textContent || '';
    const voices = this.getVoices();
    try {
      this.undoService.beforeChange('Edit Note');
      this.undoService.registerNotesCallbacks(this.model.uuid, this.undoCallback)
      this.lastModelString = '';
      const newNotes = musicLanguage.Spaced.tryParse(text);
      const uuidInfo = VM.copyUuids(voices[voiceIndex], newNotes);
      const commentsToUpdate = this.comments.filter(c => uuidInfo.lostUUIDs.find(u => c.startUUID === u || c.endUUID === u));

      if (commentsToUpdate.length > 0 && uuidInfo.fallbackUUID === undefined) {
        window.alert('Sie können diese Note nicht löschen, weil dabei ein Kommentar verloren gehen würde. Bitte entfernen Sie zunächst den Kommentar');
        this.notesToText();
        return;
      } else if (uuidInfo.fallbackUUID) {
        for (let c of commentsToUpdate) {
          if (uuidInfo.lostUUIDs.find(u => c.startUUID === u)) {
            c.startUUID = uuidInfo.fallbackUUID;
          }
          if (uuidInfo.lostUUIDs.find(u => c.endUUID === u)) {
            c.endUUID = uuidInfo.fallbackUUID;
          }
        }
      }
      
      if (voiceIndex === 0) {
        this.model.notes = newNotes;
      } else {
        if (!this.model.additionalMelodies) this.model.additionalMelodies = [];
        this.model.additionalMelodies[voiceIndex - 1] = newNotes;
      }

    } catch (e) {
      return;
    }
  }

  notesToText(): void {
    if (!this.noteTextElements) return;
    const elements = this.noteTextElements.toArray();
    const voices = this.getVoices();
    for (let i = 0; i < voices.length; i++) {
      if (elements[i]) {
        elements[i].nativeElement.textContent = spacedToString(voices[i]);
      }
    }
  }

  addSyllableTool() {
    window.clearTimeout(this.timeoutF);
    this.toolsService.addStack({
      source: this,
      tools: [
        {
          callback: () => { this.showComments(true); },
          icon: 'chat-text',
          title: 'Kommentare anzeigen'
        }
      ]
    });
  }

  setSyllFocus(focus: boolean): void {
    if (!focus) {
      if (this.focusService.preferredFocus === Focus.Text) {
        this.timeoutF = setTimeout(() => this.toolsService.remove(this), 100);
      }
    } else {
      this.addSyllableTool();
    }
  }

  setCodeAsPreferredFocus(voiceIndex: number = 0): void {
    this.focusedVoiceIndex = voiceIndex;
    this.focusService.preferredFocus = Focus.Code;
  }

  setTextAsPreferredFocus(): void {
    this.focusService.preferredFocus = Focus.Text;
    this.request.emit({ kind: "EndCommentRequested", endKind: VM.CommentPartKind.Syllable, endUUID: this.model.uuid });
  }

  drawableClicked(d: Drawable, me: MouseEvent, voiceIndex: number): void {
    this.focusedVoiceIndex = voiceIndex;
    this.focusService.preferredVoiceIndex = voiceIndex;
    me.preventDefault();
    me.stopPropagation();
    this.focusService.preferredFocus = Focus.Notes;
    const e = (this.domRoot.nativeElement as HTMLElement);
    if (d instanceof DNote || d instanceof DCommentStart || d instanceof DCommentEnd) {
      this.addNoteTools();
      this.focusService.registerFocus(() => { VM.removeFocusFromLinePart(this.model); this.cdr.markForCheck(); });
      VM.focusOne(this.getVoices()[voiceIndex], d.ref);
      // Track the selected note globally so brackets in *other* syllables
      // can light up in palette colors keyed to the comments touching this
      // note. Cleared only when the user picks a different note or clicks
      // away (see setDivFocus blur).
      this.focusService.focusedNoteUUID = d.ref.uuid;
      setTimeout(() => this.cdr.markForCheck(), 0);
      this.request.emit({ kind: "EndCommentRequested", endKind: VM.CommentPartKind.Note, endUUID: d.ref.uuid });
    }
  }

  addNoteTools() {
    window.clearTimeout(this.timeoutF);
    this.toolsService.addStack({
      source: this,
      tools: [
        {
          callback: () => { this.showComments(false); },
          icon: 'chat-text',
          title: 'Kommentare anzeigen'
        },
        {
          callback: () => { this.changeType(); this.cdr.markForCheck(); },
          icon: 'music-note-list',
          title: 'Silbenart ändern'
        },
        {
          callback: () => { this.deleteNote(false); this.cdr.markForCheck(); },
          icon: 'trash',
          title: 'Löschen'
        }
      ]
    });
  }

  changeType(): void {
    const t = this.model.syllableType;
    this.undoService.beforeChange('Edit Note');
    this.undoService.registerNotesCallbacks(this.model.uuid, this.undoCallback)
    switch (t) {
      case VM.SyllableType.Normal:
        this.model.syllableType = VM.SyllableType.WithoutNotes;
        break;
      case VM.SyllableType.WithoutNotes:
        this.model.syllableType = VM.SyllableType.SourceEllipsis;
        break;
      case VM.SyllableType.SourceEllipsis:
        this.model.syllableType = VM.SyllableType.EditorialEllipsis;
        break;
      case VM.SyllableType.EditorialEllipsis:
        this.model.syllableType = VM.SyllableType.Normal;
        break;
      default: assertNever(t);
    }

    this.refocus();
  }


  refocus(): void {
    if (this.notesDivElements) {
        (this.notesDivElements.toArray()[this.focusedVoiceIndex].nativeElement as HTMLElement).focus();
    }
  }

  calculateWidth(): number {
    let maxNoteTextWidth = 0;
    if (this.noteTextElements) {
        this.noteTextElements.forEach(el => {
            const w = textWidth(el.nativeElement.textContent || '');
            if (w > maxNoteTextWidth) maxNoteTextWidth = w;
        });
    }
    const syllableText = this.syllableTextElement ? (this.syllableTextElement.nativeElement.textContent || '') : '';
    this.noteTextWidth = maxNoteTextWidth;
    this.syllTextWidth = textWidth(syllableText);
    
    let maxSvgWidth = 0;
    const voices = this.getVoices();
    for (let i = 0; i < voices.length; i++) {
        const w = (maxOf(this.getDrawables(i).map(d => d.x)) || 0) + 4;
        if (w > maxSvgWidth) maxSvgWidth = w;
    }
    this.svgWidth = maxSvgWidth;

    return Math.max(40, this.noteTextWidth, this.syllTextWidth, this.svgWidth) + 20;
  }

  recalculateWidths(): void {
    this.syllableWidth = this.calculateWidth();
  }

  isNote: (d: Drawable) => boolean = d => d instanceof DNote;
  isTie: (d: Drawable) => boolean = d => d instanceof DTie;
  isCommentStart: (d: Drawable) => boolean = d => d instanceof DCommentStart;
  isCommentEnd: (d: Drawable) => boolean = d => d instanceof DCommentEnd;
  isHelperLine: (d: Drawable) => boolean = d => d instanceof DHelperLine;

  isThisCommentStart(): boolean {
    return this.comments.some(c => c.startUUID === this.model.uuid);
  }

  isThisCommentEnd(): boolean {
    return this.comments.some(c => c.endUUID === this.model.uuid);
  }

  /** Palette of distinguishable hues used to color comment brackets and the
   *  matching sidebar card stripes. Keep this list in sync with
   *  DocumentComponent.COMMENT_PALETTE. */
  private static readonly COMMENT_PALETTE = [
    '#2563eb', '#16a34a', '#f59e0b', '#a855f7',
    '#ec4899', '#0891b2', '#dc2626', '#84cc16',
  ];

  /** Default neutral color when nothing is selected. */
  private static readonly NEUTRAL = '#A5A5A5';

  /** Returns the palette color assigned to a given comment, based on its
   *  position in the document's comment list. Order-stable. */
  commentColor(c: VM.Comment | undefined): string {
    if (!c) return NotesComponent.NEUTRAL;
    const idx = this.comments.indexOf(c);
    if (idx < 0) return NotesComponent.NEUTRAL;
    return NotesComponent.COMMENT_PALETTE[idx % NotesComponent.COMMENT_PALETTE.length];
  }

  /** True when palette colors should currently be shown — i.e., the user has
   *  selected a note somewhere in the document. */
  get useBracketColors(): boolean {
    return !!this.focusService.focusedNoteUUID;
  }

  /** Color for the syllable-level outer bracket. `role` picks start vs end. */
  syllableBracketColor(role: 'start' | 'end'): string {
    if (!this.useBracketColors) return NotesComponent.NEUTRAL;
    const c = this.comments.find(c => role === 'start'
      ? c.startUUID === this.model.uuid
      : c.endUUID === this.model.uuid);
    return this.commentColor(c);
  }

  /** Color for the per-note bracket drawn by a DCommentStart / DCommentEnd. */
  drawableBracketColor(d: Drawable): string {
    if (!this.useBracketColors) return NotesComponent.NEUTRAL;
    if (d instanceof DCommentStart) {
      return this.commentColor(this.comments.find(c => c.startUUID === d.ref.uuid));
    }
    if (d instanceof DCommentEnd) {
      return this.commentColor(this.comments.find(c => c.endUUID === d.ref.uuid));
    }
    return NotesComponent.NEUTRAL;
  }

  /** True if the document is in step 1 of the comment-creation flow
   *  (waiting for the user to pick the start note). */
  get isPickingCommentStart(): boolean {
    return this.focusService.mode.kind === 'CommentPickStart';
  }

  /** True if the document is in step 2 (waiting for the end note). */
  get isPickingCommentEnd(): boolean {
    return this.focusService.mode.kind === 'CommentCreate';
  }

  /** True if the given drawable's note IS the currently-picked start note. */
  isPickedCommentStart(d: Drawable): boolean {
    if (this.focusService.mode.kind !== 'CommentCreate') return false;
    if (!(d instanceof DNote)) return false;
    return d.ref.uuid === this.focusService.mode.startNoteUUID;
  }

  refOfDrawable(_: number, d: Drawable): any {
    if (d instanceof DNote) {
      return d.ref.uuid;
    } else if (d instanceof DCommentStart) {
      return d.ref.uuid + 'comment-start';
    } else if (d instanceof DCommentEnd) {
      return d.ref.uuid + 'comment-end';
    } else if (d instanceof DHelperLine) {
      return d.ref.uuid + 'helper-line';
    } else {
      return d;
    }
  }

  trackByIndex(index: number, obj: any): any {
    return index;
  }
  isGroupedLayout(): boolean {
    return !!(window as any).groupedLayout;
  }
  isNormal(): boolean { return this.model.syllableType === VM.SyllableType.Normal; }
  isWithoutNotes(): boolean { return this.model.syllableType === VM.SyllableType.WithoutNotes; }
  isSourceEllipsis(): boolean { return this.model.syllableType === VM.SyllableType.SourceEllipsis; }
  isEditorEllipsis(): boolean { return this.model.syllableType === VM.SyllableType.EditorialEllipsis; }

  getWidth(): number {
    if (this.isNormal()) {
      return Math.max(40, this.noteTextWidth, this.syllTextWidth, this.svgWidth) + 20;
    } else {
      return Math.max(40, this.syllTextWidth) + 20;
    }
  }

  getWidth2(): number {
    let t = this.getWidth();
    console.log(t);
    return t;
  }

  getSVGWidth(): number {
    return this.svgWidth;
  }
}

export function spacedToString(spaced: VM.Spaced): string {
    let noteToString = (note: VM.Note) => {
    let baseStr = note.base as string;
    let explicitOctave = note.octave;

    if (note.octave === 3 && (note.base === 'A' || note.base === 'B')) {
        baseStr = note.base;
        explicitOctave = -1;
    } else if (note.octave === 4 && (note.base !== 'A' && note.base !== 'B')) {
        baseStr = note.base;
        explicitOctave = -1;
    } else if (note.octave === 4 && (note.base === 'A' || note.base === 'B')) {
        baseStr = note.base.toLowerCase();
        explicitOctave = -1;
    } else if (note.octave === 5 && (note.base !== 'A' && note.base !== 'B')) {
        baseStr = note.base.toLowerCase();
        explicitOctave = -1;
    }

    let modifierString =
      (explicitOctave !== -1 ? explicitOctave : '') +
      (note.noteType !== VM.NoteType.Normal ? VM.noteTypeToString(note.noteType) : '') +
      (note.liquescent ? 'l' : '');

    return baseStr + (modifierString !== '' ? (`[` + modifierString + `]`) : '');
  }

  return spaced.spaced.map(nonSpaced =>
    nonSpaced.nonSpaced.map(group =>
      group.grouped.map(noteToString).join('')).join(' ')).join('  ')
}

function noteFromTemplate(n: VM.Note): VM.Note {
  const newNote: VM.Note = JSON.parse(JSON.stringify(n));
  newNote.noteType = VM.NoteType.Normal;
  newNote.liquescent = false;
  newNote.uuid = UUID();
  return newNote;
}
