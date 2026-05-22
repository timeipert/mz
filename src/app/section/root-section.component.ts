import { ChangeDetectorRef, ViewChildren, QueryList, Component, OnInit, OnDestroy } from '@angular/core';
import { Subscription } from 'rxjs';
import * as S from './Section';
import * as Model from '../types/model';
import * as MS from '../types/modelStorage';
import { Event, PasteRequested, MoveRequested, NewCommentRequested } from './Event';
import { ToastrService } from 'ngx-toastr';
import { Focusable } from "../types/Focus";
import { ResolveCommentSpansRequested, CommentDeletionRequested, LineFocusShiftRequest } from "../types/CommonEvent";
import { UndoService } from '../undoService';
import { DragStateService } from '../dragger/drag-state.service';

@Component({
  selector: 'app-root-section',
  templateUrl: './section.component.html',
  styleUrls: ['./section.component.scss']
})
export class RootSectionComponent extends S.Section<Model.RootContainer> implements OnInit, OnDestroy {
  @ViewChildren("sub")
  children!: QueryList<Focusable>;

  private mapDropSub = new Subscription();

  constructor(private toaster: ToastrService, private cdr: ChangeDetectorRef, private undoService: UndoService, private dragState: DragStateService) {
    super("Editionseinheit", {
      StaleCommentRemovealRequested: (e: any, oldIndex: number) => { Model.removeStaleComments(this.data); },
      NewCommentRequested: (e: NewCommentRequested, oldIndex: number) => { this.undo.beforeChange(); this.data.comments = this.data.comments.concat([{ startUUID: e.startUUID, endUUID: e.endUUID, text: e.text }]); },
      CommentDeletionRequested: (e: CommentDeletionRequested, oldIndex: number) => { this.undo.beforeChange(); this.data.comments = this.data.comments.filter(c => c !== e.comment); },
      NoFocusRequested: (e: Event, oldIndex: number) => { Model.removeFocus(this.data); setTimeout(() => cdr.detectChanges(), 0); },
      NewFormteilRequested: (e: Event, oldIndex: number) => { this.newFormteilAt(oldIndex + 1); },
      DeletionRequested: (e: Event, oldIndex: number) => { this.undo.beforeChange(); this.data.children.splice(oldIndex, 1); Model.removeStaleComments(this.data); },
      MoveRequested: (e: MoveRequested, oldIndex: number) => {
        this.undo.beforeChange();
        const errorMessage = Model.move(this.data, e.from, e.to);
        if (errorMessage !== undefined) {
          this.toaster.error(errorMessage);
        }
        this.cdr.detectChanges();
      },
      PasteRequested: (e: PasteRequested) => this.insert(e.at, e.withoutNotes, e.withoutText),
      ResolveCommentSpansRequested: (e: ResolveCommentSpansRequested) => e.onResolve.next(e.spans.map(s => Model.extractComment(this.data, s))),
      LineFocusShiftRequest: (e: LineFocusShiftRequest) => { this.shiftFocusToNextLine(e) }
    }, undoService);
  }

  ngOnInit(): void {
    this.mapDropSub = this.dragState.dropFromMap$.subscribe(({ from, to }) => {
      this.undo.beforeChange();
      const errorMessage = Model.move(this.data, from, to);
      if (errorMessage !== undefined) {
        this.toaster.error(errorMessage);
      }
      this.cdr.detectChanges();
    });

    this.actionHandlers = {
      'Neuer Formteil': () => this.newFormteilAt(0),
      'Auf dieser Ebene einfügen': () => { this.undo.beforeChange(); this.insert([], false, false) },
      'Auf dieser Ebene einfügen (ohne Noten)': () => { this.undo.beforeChange(); this.insert([], true, false) },
      'Auf dieser Ebene einfügen (ohne Text)': () => { this.undo.beforeChange(); this.insert([], false, true) }
    };
  }

  ngOnDestroy(): void {
    this.mapDropSub.unsubscribe();
  }

  shiftFocusToNextLine(e: LineFocusShiftRequest): void {
    let index = this.data.children.findIndex(c => c.uuid === e.uuid);
    if (index >= 0 && this.data.children[index + e.direction]) {
      this.children.toArray()[index + e.direction].focus({ focusLast: (e.direction < 0) })
    } else {
      this.children.toArray()[index].focus({ focusLast: (e.direction > 0) })
    }
  }

  insert(at: number[], withoutNotes: boolean, withoutText: boolean): void {
    this.undo.beforeChange();
    const error = MS.insert(this.data, at, withoutNotes, withoutText);
    if (error === null) {
      this.toaster.success("Erfolgreich eingefügt");
    } else {
      this.toaster.error(error);
    }
    this.cdr.markForCheck();
  }

  newFormteilAt(oldIndex: number): void {
    this.undo.beforeChange();
    const newData = Model.emptyFormteilContainer(this.data.documentType, [0]);
    this.data.children.splice(oldIndex, 0, newData);
    setTimeout(() => this.children.toArray().find(p => p.getData() === newData)!.focus({ focusLast: false }), 0);
  }

  canBeDeleted(): boolean {
    return false;
  }

  documentTypes = Object.keys(Model.DocumentType)

  canChangeDocumentType(): boolean {
    return !this.data.children.every(c => c.kind === Model.ContainerKind.MiscContainer);
  }
}
