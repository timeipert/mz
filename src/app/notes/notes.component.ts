import {
  ChangeDetectorRef, Component, OnInit,
  OnDestroy, ChangeDetectionStrategy, ElementRef, ViewChild, Output, Input, EventEmitter
} from '@angular/core';
import * as VM from '../types/model';
import { fromSpaced, Drawable, DNote, DTie, DCommentStart, DCommentEnd, DHelperLine } from './Drawables';
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
import { ReplaySubject } from 'rxjs';
import { UndoService } from '../undoService';

declare const $: any;

@Component({
  selector: 'app-notes',
  templateUrl: './notes.component.html',
  styleUrls: ['./notes.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class NotesComponent implements OnDestroy, OnInit, Focusable {
  @ViewChild('noteText', { static: true }) noteTextElement!: ElementRef;
  @ViewChild('syllableText', { static: true }) syllableTextElement!: ElementRef;
  @ViewChild('notesDiv', { static: true }) notesDiv!: ElementRef;
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
  hasFocus = false;
  timeoutF: any = undefined;
  drawablesCache: Drawable[] = [];
  lastModelString = '';

  getActiveComments(): VM.Comment[] {
    const focusedNote = VM.getFocused(this.model.notes);
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

  ngOnInit() {
    this.notesToText();
    (this.syllableTextElement.nativeElement as HTMLElement).textContent = this.model.text;
    this.recalculateWidths();
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
    setTimeout(() => this.toolsService.remove(this), 0);
  }

  requestDeleteComment(c: VM.Comment): void {
    this.request.emit({ kind: 'CommentDeletionRequested', comment: c });
  }

  hasCurrentFocus(d: Drawable) {
    return this.hasFocus && (d.ref as any).focus;
  }

  setDivFocus(focus: boolean) {
    this.hasFocus = focus;
    if (focus && (VM.getFocused(this.model.notes) || this.model.syllableType !== VM.SyllableType.Normal)) {
      this.addNoteTools();
    } else {
      this.timeoutF = setTimeout(() => this.toolsService.remove(this), 200);
    }
  }

  focus(change: FocusChange): void {
    const level = change.preferredLevel || this.focusService.preferredFocus;
    switch (level) {
      case Focus.Notes:
        if (this.model.notes.spaced.length > 0 && this.model.notes.spaced[0].nonSpaced.length === 0) {
          this.requestFocusShift(level, change.focusLast, +1);
        } else {
          if (change.focusLast) { this.focusLast(); } else { this.focusFirst(); }
        }
        break;
      case Focus.Code:
        this.focusService.registerFocus(() => { VM.removeFocusFromLinePart(this.model); this.cdr.markForCheck(); });
        focusContentEditable(this.noteTextElement.nativeElement as HTMLElement, change.focusLast);
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
    VM.focusFirst(this.model.notes);
    (this.notesDiv.nativeElement as HTMLElement).focus();
  }

  private focusLast(): void {
    VM.focusLast(this.model.notes);
    (this.notesDiv.nativeElement as HTMLElement).focus();
  }

  changeNoteText(event: KeyboardEvent) {
    const oldNoteText = spacedToString(this.model.notes);
    const newNoteText = (this.noteTextElement.nativeElement as HTMLElement).textContent || '';
    //Do not call function if nothing changes thus adding empty changes to undoService
    if (oldNoteText !== newNoteText) {
      this.undoService.beforeChange('Edit Note');
      this.undoService.registerNotesCallbacks(this.model.uuid, this.undoCallback)
      event.stopPropagation();
      event.preventDefault();
      this.textToNotes();
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
      const modalRef = this.modalService.open(CommentComponent, { size: 'xl', fullscreen: true });
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
      this.focus({ focusLast: false });
    }
    if (event.ctrlKey && event.key === 'z') {
      event.stopPropagation();
      event.preventDefault();
      this.undoService.undo();
    }
  }

  onNoteTextDown(event: KeyboardEvent): void {
    handleTextInputMove(this.noteTextElement.nativeElement, event, e => this.request.emit(e));
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.focusService.preferredFocus = Focus.Text;
      this.focus({ focusLast: false });
      focusContentEditable(this.syllableTextElement.nativeElement, 2);
    }
    if (event.ctrlKey && event.key === 'z') {
      event.stopPropagation();
      event.preventDefault();
      this.undoService.undo();
    }
  }

  splitAndCreateNewSegments(text: string): void {
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
      for (let i = newTextSegments.length - 1; i > 0; i--) {
        this.request.emit({ kind: 'NewSegmentRequested', syllableType: this.model.syllableType, text: newTextSegments[i] });
      }
      const thisNewText = newTextSegments[0];
      (this.syllableTextElement.nativeElement as HTMLElement).textContent = thisNewText;
      this.model.text = thisNewText;
    }
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

    if ((e.altKey || e.metaKey) && e.key === 'k') {
      //Trigger comment
      this.request.emit({ kind: "StartCommentRequested", startKind: VM.CommentPartKind.Syllable, startUUID: this.model.uuid });
    } else {
      if (oldText !== newText) {
        if (e.key === '-') {
          e.stopPropagation();
          e.preventDefault();
          this.undoService.beforeChange('Edit Note');
          const text = (this.syllableTextElement.nativeElement as HTMLElement).textContent;
          if (text) {
            this.splitAndCreateNewSegments(text);
          }
        } else {
          this.undoService.beforeChange('Edit Note');
          this.undoService.registerNotesCallbacks(this.model.uuid, this.undoCallback)
          this.model.uuid
          const newContent = (this.syllableTextElement.nativeElement as HTMLElement).textContent || '';
          this.model.text = newContent;
        }
      }
    }
    this.recalculateWidths();
  }

  clickOn(e: MouseEvent): void {
    e.preventDefault();
    e.stopPropagation();
    if (this.model.notes.spaced[0].nonSpaced.length === 0) {
      this.undoService.beforeChange('Edit Note');
      this.undoService.registerNotesCallbacks(this.model.uuid, this.undoCallback)
      this.model.notes = VM.emptySyllable().notes;
      this.model.notes.spaced[0].nonSpaced[0].grouped[0] = this.getNoteByClickPos(e.offsetY);
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

  keyDown(e: KeyboardEvent): void {
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'ArrowUp') { this.changePitch(VM.nextNote); }
    else if (e.altKey && e.key === 't') { this.request.emit({ kind: 'EditSyllableTextReqested' }); }
    else if (e.altKey && e.key === 'n') { this.request.emit({ kind: 'EditNotesTextReqested' }); }
    else if (e.altKey && e.key === 'ArrowRight') { this.insertOrShiftRight(); }
    else if (e.altKey && e.key === 'ArrowLeft') { } //do nothing
    else if (e.altKey && e.key === 'Enter') { this.splitLine(); }
    else if (e.ctrlKey && e.key === '.') { this.request.emit({ kind: 'ChangeToBoxRequested' }); }
    else if (e.altKey && e.key === '.') { this.request.emit({ kind: 'ChangeToBoxRequested' }); }
    else if (e.key === 'ArrowDown') { this.changePitch(VM.previousNote); }
    else if (e.key === 'ArrowLeft') { this.focusOther(VM.getLeftOf, () => this.requestFocusShift(undefined, true, -1)); }
    else if (e.key === 'ArrowRight') { this.focusOther(VM.getRightOf, () => this.requestFocusShift(undefined, false, +1)); }
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
    else if (e.key === 'k') { this.startComment(); }
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
            this.request.emit({ kind: 'DeletionRequested', focusLast });
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

  startComment(): void {
    this.withFocus(f => {
      this.request.emit({ kind: "StartCommentRequested", startKind: VM.CommentPartKind.Note, startUUID: f.uuid });
    });
  }

  changePitch(producer: (n: VM.Note) => VM.Note): void {
    this.withFocus(f => {
      this.undoService.beforeChange('Edit Note');
      this.undoService.registerNotesCallbacks(this.model.uuid, this.undoCallback)
      const newNote = producer(f);
      f.octave = newNote.octave;
      f.base = newNote.base;
    });
  }

  focusOther(selector: (s: VM.Spaced, f: VM.Note) => VM.Note | undefined, notFoundAction: () => void): void {
    this.withOther(f => selector(this.model.notes, f), (focused, other) => {
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
    const path = VM.getFocusedPath(this.model.notes);
    if (path !== undefined) {
      const [s, ns, gr, no] = path;
      return f(s, ns, gr, no);
    }
  }

  withFocus(f: (focused: VM.Note) => void): void {
    const focused = VM.getFocused(this.model.notes);
    if (focused) f(focused);
  }

  getDrawables(): Drawable[] {
    const newModelString = JSON.stringify([this.model, this.comments]);
    if (this.lastModelString === newModelString) {
      return this.drawablesCache;
    } else {
      this.lastModelString = newModelString;
      this.drawablesCache = fromSpaced(this.model.notes, this.comments);
      return this.drawablesCache;
    }
  }

  textToNotes(): void {
    const text = (this.noteTextElement.nativeElement as HTMLElement).textContent || '';
    try {
      this.undoService.beforeChange('Edit Note');
      this.undoService.registerNotesCallbacks(this.model.uuid, this.undoCallback)
      this.lastModelString = '';
      const newNotes = musicLanguage.Spaced.tryParse(text);
      const uuidInfo = VM.copyUuids(this.model.notes, newNotes);
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
      this.model.notes = newNotes;
    } catch (e) {
      return;
    }
  }

  notesToText(): void {
    (this.noteTextElement.nativeElement as HTMLElement).textContent = spacedToString(this.model.notes);
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

  setCodeAsPreferredFocus(): void {
    this.focusService.preferredFocus = Focus.Code;
  }

  setTextAsPreferredFocus(): void {
    this.focusService.preferredFocus = Focus.Text;
    this.request.emit({ kind: "EndCommentRequested", endKind: VM.CommentPartKind.Syllable, endUUID: this.model.uuid });
  }

  drawableClicked(d: Drawable, me: MouseEvent): void {
    me.preventDefault();
    me.stopPropagation();
    this.focusService.preferredFocus = Focus.Notes;
    const e = (this.domRoot.nativeElement as HTMLElement);
    if (d instanceof DNote || d instanceof DCommentStart || d instanceof DCommentEnd) {
      this.addNoteTools();
      this.focusService.registerFocus(() => { VM.removeFocusFromLinePart(this.model); this.cdr.markForCheck(); });
      VM.focusOne(this.model.notes, d.ref);
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
    (this.notesDiv.nativeElement as HTMLElement).focus();
  }

  calculateWidth(): number {
    const noteText = this.noteTextElement.nativeElement.textContent || '';
    const syllableText = this.syllableTextElement.nativeElement.textContent || '';

    this.noteTextWidth = textWidth(noteText);
    this.syllTextWidth = textWidth(syllableText);
    this.svgWidth = (maxOf(this.getDrawables().map(d => d.x)) || 0) + 4;

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
    let modifierString =
      (note.octave !== 4 ? note.octave : '') +
      (note.noteType !== VM.NoteType.Normal ? VM.noteTypeToString(note.noteType) : '') +
      (note.liquescent ? 'l' : '');

    return note.base + (modifierString !== '' ? (`[${modifierString}]`) : '');
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
