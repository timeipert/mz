import { ViewChildren, QueryList, Component, OnInit, ElementRef, ViewChild, OnDestroy, ChangeDetectorRef } from '@angular/core';
import * as S from './Section';
import * as Model from '../types/model';
import * as R from '../notes/Request';
import { assertNever, handleFocusChangeFromParent } from '../../utils';
import { Focusable, Focus, FocusChange } from '../types/Focus';
import { FocusShiftRequested } from '../types/CommonEvent';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { EditSyllableTextComponent } from '../edit-syllable-text/edit-syllable-text.component';
import { spacedToString } from '../notes/notes.component';
import { musicLanguage } from '../notes/language';
import { Observable } from 'rxjs';
import { FocusService } from '../focus.service';
import { take } from 'rxjs/operators';
import { ToastrService } from 'ngx-toastr';
import { v4 as UUID } from "uuid";
import { UndoService } from '../undoService';

@Component({
  selector: 'app-zeile-section',
  templateUrl: './section.component.html',
  styleUrls: ['./section.component.scss'],
})
export class ZeileSectionComponent extends S.Section<Model.ZeileContainer> implements OnInit, OnDestroy, Focusable {
  @ViewChild('syllableModalEdit', { static: true }) syllableModalEdit!: ElementRef;
  @ViewChildren('linechild')
  children!: QueryList<Focusable>;
  subscription!: Observable<string>;

  constructor(
    private modalService: NgbModal,
    private changeRef: ChangeDetectorRef,
    private toastr: ToastrService,
    private focusService: FocusService,
    private undoService: UndoService
  ) {
    super('Notenzeile', {}, undoService);
  }

  ngOnInit(): void {
    this.actionHandlers = {
      '+ Line': () => this.onEvent.emit({ 'kind': 'NewNoteLineRequsted', container: Model.emptyZeileContainer() }),
      'Edit Notes': () => this.editText({ 'kind': 'EditNotesTextReqested' }),
      'Edit Syllables': () => this.editText({ 'kind': 'EditSyllableTextReqested' }),
      '+ Text': () => this.onEvent.emit({ 'kind': 'NewParatextRequested' })
    };
  }

  ngOnDestroy(): void {
    // this.subscription.unsubscribe(); TODO XXXX
  }

  getSyllableText(): string {
    let text = '';
    const syllables = this.data.children.filter(c => c.kind === 'Syllable');
    syllables.forEach(syl => {
      text += (syl as Model.Syllable).text;
      if (!text.endsWith('-')) {
        text += ' ';
      }
    });
    return text.trim();
  }

  getNotesText(): string {
    let text = '';
    const syllables = this.data.children.filter(c => c.kind === 'Syllable');
    syllables.forEach((syl, index) => {
      const notes = (syl as Model.Syllable).notes;
      text += spacedToString(notes);
      if (index < syllables.length - 1) {
        text += ',';
      }
    });
    return text.trim();
  }

  private editText(r: R.Request) {
    const modalRef = this.modalService.open(EditSyllableTextComponent);
    this.subscription = modalRef.componentInstance.updateSyllableText;
    switch (r.kind) {
      case 'EditSyllableTextReqested':
        modalRef.componentInstance.title = 'Silbentext editieren';
        modalRef.componentInstance.text = this.getSyllableText();
        this.subscription.pipe(take(1)).subscribe((text: string) => this.reciveSyllableText(text));
        break;
      case 'EditNotesTextReqested':
        modalRef.componentInstance.title = 'Notentext editieren';
        modalRef.componentInstance.text = this.getNotesText();
        this.subscription.pipe(take(1)).subscribe((text: string) => this.reciveNotesText(text));
        break;
    }
  }

  reciveNotesText(newNotes: string) {
    this.undo.beforeChange();
    const newNotesArray = newNotes.split(/,(?!\])/);
    const childrenCopy = JSON.parse(JSON.stringify(this.data.children));
    this.data.children = [];
    this.changeRef.detectChanges();

    let newNotesIndex = 0;
    for (let i = 0; i < childrenCopy.length; i++) {
      const childCopy = JSON.parse(JSON.stringify(childrenCopy[i] as Model.Syllable));
      if (childCopy.kind === 'Syllable') {
        if (newNotesIndex < newNotesArray.length) {
          (childCopy as Model.Syllable).notes = this.textToNotes(newNotesArray[newNotesIndex], (childCopy as Model.Syllable).notes);
          newNotesIndex++;
        } else {
          (childCopy as Model.Syllable).notes = musicLanguage.Spaced.tryParse('');
        }
      }
      this.data.children.push(childCopy);
    }
    if (newNotesIndex < newNotesArray.length) {
      for (let i = newNotesIndex; i < newNotesArray.length; i++) {
        const newData = Model.emptySyllable();
        try {
          newData.notes = musicLanguage.Spaced.tryParse(newNotesArray[i]);
        } catch (e) {
          window.alert('Es wurde eine ungültige Eingabe erkannt ' + newNotesArray[i]);
        }
        this.data.children.push(newData);
      }
    }
  }

  textToNotes(data: string, notes: Model.Spaced): Model.Spaced {
    try {
      const newNotes = musicLanguage.Spaced.tryParse(data);
      const uuidInfo = Model.copyUuids(notes, newNotes);
      const commentsToUpdate = this.comments.filter(c => uuidInfo.lostUUIDs.find(u => c.startUUID === u || c.endUUID === u));

      if (commentsToUpdate.length > 0 && uuidInfo.fallbackUUID === undefined) {
        window.alert(
          'Sie können diese Note nicht löschen, weil dabei ein Kommentar verloren gehen würde. Bitte entfernen Sie zunächst den Kommentar');
        return notes;
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
      return newNotes;
    } catch (e) {
      console.log(e);
      window.alert('Error beim parsen von neuen Notentexten');
      return notes;
    }
  }


  private focusChild(model: any, level: Focus | undefined, fromLast: boolean = false) {
    this.children.toArray().find(n => n.getData() === model)!.focus({
      focusLast: fromLast,
      preferredLevel: level
    });
  }

  reciveSyllableText(newData: string) {
    this.undo.beforeChange();
    let syllableArray: Array<string> = [];
    const newSyllables = newData.match(/([^-\s]*((\s|-)?\b))/gi);
    if (newSyllables) {
      syllableArray = newSyllables.filter(s => s !== '');
    }
    const childrenCopy = JSON.parse(JSON.stringify(this.data.children));
    this.data.children = [];
    this.changeRef.detectChanges();

    let syllableCounter = 0;
    for (let i = 0; i < childrenCopy.length; i++) {
      const childCopy = JSON.parse(JSON.stringify(childrenCopy[i] as Model.Syllable));
      if (childCopy.kind === 'Syllable') {
        if (syllableCounter < syllableArray.length) {
          childCopy.text = syllableArray[syllableCounter].trim();
        } else {
          childCopy.text = '';
        }
        syllableCounter++;
      }
      this.data.children.push(childCopy);
    }
    if (syllableCounter < syllableArray.length) {
      for (let k = syllableCounter; k < syllableArray.length; k++) {
        if (syllableArray[k] !== '') {
          const newData = Model.emptySyllable();
          newData.text = syllableArray[k].trim();
          this.data.children.push(newData);
        }
      }
    }
  }

  /**
   * Splits Syllable and will return a new Syllable of elements at the point of split
   * The split will happen at the first focused note and the given Syllable will be shortend
   * @param syllable Model.Syllable
   */
  splitSyllable(syllable: Model.Syllable): Model.Syllable {
    this.undo.beforeChange();
    let syll: Model.Syllable = JSON.parse(JSON.stringify(syllable));
    let newSyll = Model.emptySyllable();
    newSyll.notes.spaced = [];
    let splitSyl: number = syll.notes.spaced.findIndex(s => s.nonSpaced.findIndex(n => n.grouped.findIndex(g => g.focus === true) >= 0) >= 0);

    for (let i = splitSyl; i < syllable.notes.spaced.length; i++) {
      let ns: Model.NonSpaced = syll.notes.spaced[i];
      let splitNS: number = ns.nonSpaced.findIndex(n => n.grouped.findIndex(g => g.focus === true) >= 0);
      let nonSpacedCopy: Model.NonSpaced = JSON.parse(JSON.stringify(ns))
      let newNoneSpaced: Model.Grouped[] = [];
      //split NonSpaced
      if (splitNS >= 0) {
        for (let j = splitNS; j < ns.nonSpaced.length; j++) {
          let g: Model.Grouped = ns.nonSpaced[j];
          let groupCopy: Model.Grouped = JSON.parse(JSON.stringify(g))
          let splitGr: number = g.grouped.findIndex(n => n.focus === true);
          //split Grouped
          if (splitGr >= 0) {
            let split: Model.Note[] = groupCopy.grouped.slice(splitGr);
            groupCopy.grouped = split;
            newNoneSpaced.push(groupCopy)
          } else {
            //else copy
            newNoneSpaced.push(groupCopy)
          }
          //shorten original
          if (splitGr >= 0) {
            syllable.notes.spaced[i].nonSpaced[j].grouped.length = splitGr;
          }
        }
        nonSpacedCopy.nonSpaced = newNoneSpaced;
        newSyll.notes.spaced.push(nonSpacedCopy);

      } else {
        //else copy
        newSyll.notes.spaced.push(nonSpacedCopy);
      }
      //shorten orginial NonSpaced
      if (splitNS >= 0) {
        syllable.notes.spaced[i].nonSpaced.length = splitNS + 1;
      }

    }
    //shorten orginial spaced
    if (splitSyl >= 0) {
      syllable.notes.spaced.length = splitSyl + 1
    }

    return newSyll;
  }


  onLinePartRequest(r: R.Request, child: Model.LinePart): void {
    switch (r.kind) {
      case 'NewCommentRequested': this.onEvent.emit(r); break;
      case 'NoFocusRequested': this.onEvent.emit({ kind: 'NoFocusRequested' }); break;
      case 'NewLineRequested': this.onEvent.emit({ kind: 'NewNoteLineRequsted', container: Model.emptyZeileContainer() }); break;
      case 'SplitLineRequested': {
        this.undo.beforeChange();
        const childIndex = this.data.children.indexOf(child);
        const copy: Model.ZeileContainer = { uuid: UUID(), kind: this.data.kind, children: [...this.data.children] };
        this.data.children.length = childIndex + 1;
        copy.children.splice(0, childIndex + 1);

        let secondHalf = Model.emptySyllable()
        if (child.kind === "Syllable") {
          secondHalf = this.splitSyllable(child);
          copy.children.unshift(secondHalf);
        }
        this.onEvent.emit({ kind: 'NewNoteLineRequsted', container: copy });
        break;
      }
      case 'NewSegmentRequested': {
        this.undo.beforeChange();
        const oldIndex = this.data.children.indexOf(child);
        const newData = Model.trueEmptySyllable();
        //const newData = Model.emptySyllable();
        if (r.text) {
          newData.text = r.text;
        }
        newData.syllableType = r.syllableType;
        this.data.children.splice(oldIndex + 1, 0, newData);
        setTimeout(() => this.focusChild(newData, undefined), 0);
        break;
      }
      case 'DeletionRequested': {
        if (Model.linePartContainsComments(child, this.comments)) {
          window.alert('Bitte entfernen Sie zuerst alle Kommentare, bevor Sie diesen Teil löschen');
          break;
        }
        this.undo.beforeChange();
        const childIndex = this.data.children.indexOf(child);
        this.data.children.splice(childIndex, 1);
        if (this.data.children.length > 0) {
          const newIndex = r.focusLast ? childIndex - 1 : childIndex;
          if (newIndex < 0) {
            this.onEvent.emit({ kind: 'FocusShiftRequested', change: { focusLast: true }, direction: -1 });
          } else if (newIndex >= this.data.children.length) {
            this.onEvent.emit({ kind: 'FocusShiftRequested', change: { focusLast: false }, direction: +1 });
          } else {
            this.focusChild(this.data.children[newIndex], undefined, r.focusLast);
          }
        } else {
          this.onEvent.emit({ kind: 'DeletionRequested', focusLast: r.focusLast });
        }
        break;
      }
      case 'LineChangeRequested': {
        this.undo.beforeChange();
        const offset: number = r.after ? 1 : 0;
        const oldIndex = this.data.children.indexOf(child);
        const newData = Model.emptyLineChange();
        this.data.children.splice(oldIndex + offset, 0, newData);
        setTimeout(() => this.focusChild(newData, undefined), 0);
        break;
      }
      case 'LineChangeToFolioChangeRequested': {
        this.undo.beforeChange();
        const oldIndex = this.data.children.indexOf(child);
        const newData = Model.emptyFolioChange();
        this.data.children.splice(oldIndex, 1, newData);
        setTimeout(() => this.focusChild(newData, Focus.Text), 0);
        break;
      }
      case 'CommentDeletionRequested': this.onEvent.emit(r); break;
      case 'FocusShiftRequested': {
        const delta = r.change.focusLast ? -1 : +1;
        const newIndex = this.data.children.indexOf(child);
        this.setFocusToNextChild(r, newIndex, delta);
        break;
      }
      case 'ChangeToBoxRequested':
        this.undo.beforeChange();
        const oldIndex = this.data.children.indexOf(child);
        const boxData = Model.emptyBox();
        this.data.children.splice(oldIndex, 1, boxData);
        setTimeout(() => this.focusChild(boxData, Focus.Text), 0);
        break;

      case 'NewClefRequested': {
        this.undo.beforeChange();
        const oldIndex = this.data.children.indexOf(child);
        const newData = Model.emptyClef();
        this.data.children.splice(oldIndex + 1, 0, newData);
        setTimeout(() => this.focusChild(newData, Focus.Text), 0);
        break;
      }
      case 'EditNotesTextReqested':
      case 'EditSyllableTextReqested': {
        this.undo.beforeChange();
        this.editText(r);
        break;
      }
      case 'ResolveCommentSpansRequested': {
        this.onEvent.emit(r);
        break;
      }
      case 'AddNoteToNextSegment': {
        this.undo.beforeChange();
        const oldIndex = this.data.children.indexOf(child);
        const nextData = this.data.children[oldIndex + 1];
        if (nextData) {
          if (nextData.kind === 'Syllable') {
            if (nextData.notes.spaced[0].nonSpaced.length === 0) {
              const newSyll = Model.emptySyllable();
              newSyll.notes.spaced[0].nonSpaced[0].grouped[0] = Model.copyNote(r.note);
              newSyll.text = nextData.text;
              this.data.children[oldIndex + 1] = newSyll;
              setTimeout(() => this.focusChild(this.data.children[oldIndex + 1], undefined), 0);
            } else if (nextData.notes.spaced[0].nonSpaced[0].grouped.length === 0) {
              const newSyll = Model.emptySyllable();
              newSyll.notes.spaced[0].nonSpaced[0].grouped[0] = Model.copyNote(r.note);
              newSyll.text = nextData.text;
              this.data.children[oldIndex + 1] = newSyll;
              setTimeout(() => this.focusChild(this.data.children[oldIndex + 1], undefined), 0);
            }
          }
        } else {
          //const oldIndex = this.data.children.indexOf(child);
          const newData = Model.trueEmptySyllable();
          newData.notes.spaced[0].nonSpaced[0].grouped[0] = Model.copyNote(r.note);
          this.data.children.push(newData);
          setTimeout(() => this.focusChild(newData, undefined), 0);
          break;
        }
        break;
      }
      case 'StartCommentRequested': {
        this.startComment(r.startUUID);
        break;
      }
      case 'EndCommentRequested': {
        this.endComment(r.endUUID, r.endKind)
        break;
      }
      case 'LineFocusShiftRequest': {
        break;
      }
      case 'ViewIiifRequested': {
        this.onEvent.emit(r);
        break;
      }
      case 'HighlightRegionRequested': {
        this.onEvent.emit(r);
        break;
      }
      default: assertNever(r);
    }
  }

  startComment(startUUID: string) {
    if (this.focusService.mode.kind === 'Normal') {
      this.focusService.mode = { kind: 'CommentCreate', startNoteUUID: startUUID };
      this.toastr.info('Selektieren Sie den Endpunkt für den Kommentar');
    }
  }

  endComment(endUUID: string, kind: Model.CommentPartKind) {
    if (this.focusService.mode.kind === 'CommentCreate') {
      this.undo.beforeChange();
      const firstUUID = this.focusService.mode.startNoteUUID;
      const text = window.prompt('Bitte geben Sie den Kommentar text ein:');
      if (text) {

        let t: string[] = Model.getAllCommentableUUIDs(this.data);
        let indexStart = t.indexOf(firstUUID);
        let indexEnd = t.indexOf(endUUID);

        console.log(kind);
        console.log(indexStart);
        console.log(indexEnd);

        if (kind !== Model.CommentPartKind.Syllable && indexEnd < indexStart) {
          this.onEvent.emit(
            { startUUID: endUUID, endUUID: firstUUID, text: text, kind: 'NewCommentRequested' }
          )
        } else {
          this.onEvent.emit(
            { startUUID: firstUUID, endUUID: endUUID, text: text, kind: 'NewCommentRequested' }
          )
        }
      }
      this.focusService.mode = { kind: "Normal" }
    }
  }

  setFocusToNextChild(r: FocusShiftRequested, index: number, direction: number): void {
    const childModel = this.data.children[index + direction];
    if (childModel) {
      this.focusChild(childModel, r.change.preferredLevel, r.change.focusLast);
    } else {
      this.onEvent.emit({ kind: 'FocusShiftRequested', change: { focusLast: (direction < 0) }, direction: direction });
    }
  }

  getData(): any {
    return this.data;
  }

  focus(change: FocusChange): void {
    handleFocusChangeFromParent(change, this.children.toArray());
  }
}

