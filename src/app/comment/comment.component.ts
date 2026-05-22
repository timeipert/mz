import { Component, OnInit, Input, Output, EventEmitter } from '@angular/core';
import * as M from '../types/model';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { Event } from '../section/Event';
import * as MS from '../types/modelStorage';
import { ToastrService } from 'ngx-toastr';

@Component({
  selector: 'app-comment',
  templateUrl: './comment.component.html',
  styleUrls: ['./comment.component.scss']
})
export class CommentComponent implements OnInit {
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

  deleteComment(c: M.Comment): void {
    this.comments[this.comments.indexOf(c)] = null;
  }

  onSave() {
    this.saveEvent.emit(this.comments);
    this.activeModal.close();
  }

  onExit() {
    this.activeModal.close();
  }

  setCommentType(c: M.Comment, type: 'text' | 'lines' | 'tree'): void {
    c.commentType = type;
    if (type === 'lines' && !c.lines) {
      this.addLine(c);
    } else if (type === 'tree' && !c.tree) {
      this.addTree(c);
    }
  }

  addLine(c: M.Comment): void {
    c.lines = [JSON.parse(JSON.stringify(this.originals[this.comments.indexOf(c)]))];
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
        break;
      case "NewParatextRequested": {
        this.insertAt(commentIndex, lineIndex, M.emptyParatextContainer());
        break;
      }
      case "DeletionRequested": {
        this.deleteAt(commentIndex, lineIndex);
        break;
      }
      case "PasteRequested": {
        this.copyAndPaste(commentIndex, lineIndex, e.withoutNotes, e.withoutText);
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
  }

}
