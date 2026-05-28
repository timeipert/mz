import { Component, OnInit, Input, Output, EventEmitter } from '@angular/core';
import * as M from '../types/model';

import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { Event } from '../section/Event';
import * as MS from '../types/modelStorage';
import { ToastrService } from 'ngx-toastr';

interface CommentHistory {
  past: string[];
  future: string[];
}

@Component({
  selector: 'app-comment',
  templateUrl: './comment.component.html',
  styleUrls: ['./comment.component.scss']
})

export class CommentComponent implements OnInit {
  private histories = new Map<M.Comment, CommentHistory>();

  @Input()
  comments!: (M.Comment | null)[];

  @Input()
  originals!: M.ZeileContainer[];

  @Output()
  saveEvent = new EventEmitter<(M.Comment | null)[]>();

  constructor(
    public activeModal: NgbActiveModal,
    private toaster: ToastrService
  ) { }

  ngOnInit() {
    this.comments.forEach(c => {
      if (c && !c.commentType) {
        if (c.tree) c.commentType = 'tree';
        else if (c.lines) c.commentType = 'lines';
        else c.commentType = 'text';
      }
    });
  }


  getHistory(c: M.Comment): CommentHistory {
    if (!this.histories.has(c)) {
      this.histories.set(c, { past: [], future: [] });
    }
    return this.histories.get(c)!;
  }

  onTextChange(c: M.Comment, newText: string) {
    if (c.text !== newText) {
      const history = this.getHistory(c);
      history.past.push(c.text || '');
      history.future = []; // Clear redo stack on new change
      c.text = newText;
      this.autoSave();
    }
  }

  undoText(c: M.Comment) {
    const history = this.getHistory(c);
    if (history.past.length > 0) {
      history.future.push(c.text || '');
      c.text = history.past.pop()!;
      this.autoSave();
    }
  }

  redoText(c: M.Comment) {
    const history = this.getHistory(c);
    if (history.future.length > 0) {
      history.past.push(c.text || '');
      c.text = history.future.pop()!;
      this.autoSave();
    }
  }

  canUndo(c: M.Comment): boolean {
    return this.getHistory(c).past.length > 0;
  }

  canRedo(c: M.Comment): boolean {
    return this.getHistory(c).future.length > 0;
  }


  onEmendationChange(c: M.Comment, value: boolean) {
    c.emendation = value;
    this.autoSave();
  }

  deleteComment(c: M.Comment): void {


    this.comments[this.comments.indexOf(c)] = null;
    this.autoSave();
  }


  autoSave() {
    this.saveEvent.emit(this.comments);
  }

  onExit() {
    this.activeModal.dismiss();
  }

  setCommentType(c: M.Comment, type: 'text' | 'lines' | 'tree'): void {
    c.commentType = type; this.autoSave();
    if (type === 'lines' && !c.lines) {
      this.addLine(c);
    } else if (type === 'tree' && !c.tree) {
      this.addTree(c);
    }
  }

  addLine(c: M.Comment): void {
    c.lines = [JSON.parse(JSON.stringify(this.originals[this.comments.indexOf(c)]))]; this.autoSave();
  }

  originalCreator(c: M.Comment) {
    return () => JSON.parse(JSON.stringify(this.originals[this.comments.indexOf(c)]))
  }

  addTree(c: M.Comment): void {
    c.tree = M.emptyCommentTree();
  }

  removeLine(c: M.Comment): void {
    delete c.lines;
  }

  activeComments(): M.Comment[] {
    return this.comments.filter(c => c !== null) as M.Comment[];
  }

  getOriginal(index: number): M.ZeileContainer {
    return this.originals[index];
  }

  private insertAt(commentIndex: number, atLine: number, item: M.FormteilChildren): void {
    if (this.comments[commentIndex]) {
      let lines = this.comments[commentIndex]!.lines;
      if (lines) {
        lines.splice(atLine + 1, 0, item)
      }
    }
  }

  private deleteAt(commentIndex: number, deletionIndex: number): void {
    if (this.comments[commentIndex]) {
      let lines = this.comments[commentIndex]!.lines;
      if (lines) {
        lines.splice(deletionIndex, 1);
      }
    }
  }


  private copyAndPaste(commentIndex: number, lineIndex: number, withoutNotes: boolean, withoutText: boolean): void {
    if (this.comments[commentIndex]) {
      let lines = this.comments[commentIndex]!.lines;
      if (lines) {
        let copy = MS.getStore();
        if (copy && (copy.data.kind === "ZeileContainer" || copy.data.kind === "ParatextContainer")) {
          copy.data
          M.unsafeGenerateNewUUIDs(copy.data);
          if (copy.data.kind === "ZeileContainer") {
            if (withoutNotes) {
              M.getSyllables(copy.data).forEach(s => { s.notes = { spaced: [] } });
            }
            if (withoutText) {
              M.getSyllables(copy.data).forEach(s => { s.text = "" });
            }
            this.insertAt(commentIndex, lineIndex, copy.data);
          } else if (copy.data.kind === "ParatextContainer") {
            this.insertAt(commentIndex, lineIndex, copy.data);
          }
        }
        else {
          this.toaster.warning("Es können nur NotenZeilen und Paratexte als Kommentar eingefügt werden");
        }
      }
    }
  }

  handleEvent(e: Event, commentIndex: number, lineIndex: number) {
    switch (e.kind) {
      case "NewNoteLineRequsted":
        this.insertAt(commentIndex, lineIndex, M.emptyZeileContainer());
        this.autoSave();
        break;
      case "NewParatextRequested": {
        this.insertAt(commentIndex, lineIndex, M.emptyParatextContainer());
        this.autoSave();
        break;
      }
      case "DeletionRequested": {
        this.deleteAt(commentIndex, lineIndex);
        this.autoSave();
        break;
      }
      case "PasteRequested": {
        this.copyAndPaste(commentIndex, lineIndex, e.withoutNotes, e.withoutText);
        this.autoSave();
        break;
      }
      case "NewFormteilRequested": {
        this.toaster.info("Diese Operation wird bei Kommentaren nicht unterstützt");
        break;
      }
      default:
        this.toaster.error("Unerwarteter aufruf " + e.kind);
        break;
    }
  }

  handleCommentTreeEvent(e: M.CommentTreeEvent, comment: M.Comment) {
    comment.tree = M.applyCommentTreeEvent(comment.tree!, e);
    this.autoSave();
  }

}
