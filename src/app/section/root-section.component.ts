import { ChangeDetectorRef, ViewChildren, QueryList, Component, OnInit, OnDestroy, Input } from '@angular/core';
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
import { NavigationService } from '../notationsdokumentation/navigation.service';

@Component({
  selector: 'app-root-section',
  templateUrl: './section.component.html',
  styleUrls: ['./section.component.scss']
})
export class RootSectionComponent extends S.Section<Model.RootContainer> implements OnInit, OnDestroy {
  @ViewChildren("sub")
  children!: QueryList<Focusable>;

  @Input() sourceId?: string;

  private mapDropSub = new Subscription();

  constructor(private toaster: ToastrService, private cdr: ChangeDetectorRef, private undoService: UndoService, private dragState: DragStateService, private navService: NavigationService) {
    super("Edition unit", {
      StaleCommentRemovealRequested: (e: any, oldIndex: number) => { Model.removeStaleComments(this.data); },
      NewCommentRequested: (e: NewCommentRequested, oldIndex: number) => { this.undo.beforeChange(); this.data.comments = this.data.comments.concat([{ startUUID: e.startUUID, endUUID: e.endUUID, text: e.text }]); },
      CommentDeletionRequested: (e: CommentDeletionRequested, oldIndex: number) => { this.undo.beforeChange(); this.data.comments = this.data.comments.filter(c => c !== e.comment); },
      NoFocusRequested: (e: Event, oldIndex: number) => { Model.removeFocus(this.data); setTimeout(() => cdr.detectChanges(), 0); },
      NewParatextRequested: (e: Event, oldIndex: number) => { this.undo.beforeChange(); this.newAt(Model.emptyParatextContainer(), oldIndex + 1); },
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
      LineFocusShiftRequest: (e: LineFocusShiftRequest) => { this.shiftFocusToNextLine(e) },
      ViewIiifRequested: (e: any) => { 
        if (this.sourceId) this.navService.openIiifViewerForFolio(this.sourceId, e.folio); 
      },
      HighlightRegionRequested: (e: any) => {
        this.onEvent.emit(e);
      }
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
      '+ L1': () => this.newFormteilAt(0),
      '+ Text': () => { this.undo.beforeChange(); this.newAt(Model.emptyParatextContainer(), 0); },
      'Paste after': () => { this.undo.beforeChange(); this.insert([], false, false) },
      'Paste after (discard notes)': () => { this.undo.beforeChange(); this.insert([], true, false) },
      'Paste after (discard text)': () => { this.undo.beforeChange(); this.insert([], false, true) }
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

  newAt(child: any, newIndex: number) {
    this.undo.beforeChange();
    this.data.children.splice(newIndex, 0, child);
    setTimeout(() => {
      const focusTarget = this.children.toArray().find(sft => sft.getData() === child);
      if (focusTarget) focusTarget.focus({ focusLast: false });
    }, 0);
  }

  canBeDeleted(): boolean {
    return false;
  }

  documentTypes = [
    { value: 'Level1', label: '1' },
    { value: 'Level2', label: '2' },
    { value: 'Level3', label: '3' }
  ];

  canChangeDocumentType(): boolean {
    return !this.data.children.every(c => c.kind === Model.ContainerKind.MiscContainer);
  }

  /** Called by the button-group in the template. Sets the documentType AND always triggers
   *  structure initialisation — even when the user clicks the already-selected level. */
  setDocumentType(value: string): void {
    this.data.documentType = value as Model.DocumentType;
    this.onDocumentTypeChange();
  }

  onDocumentTypeChange(): void {
    if (this.data.children.length === 0) {
      this.undo.beforeChange();
      const level = parseInt(this.data.documentType.replace(/level/i, ''), 10) || 1;

      let currentContainer: any = this.data;
      let zipperPath: number[] = [];

      for (let i = 0; i < level; i++) {
        const newFormteil = Model.emptyFormteilContainer(this.data.documentType, [...zipperPath, 0]);
        currentContainer.children.push(newFormteil);
        currentContainer = newFormteil;
        zipperPath.push(0);
      }

      const newLine = Model.emptyZeileContainer();
      currentContainer.children.push(newLine);

      this.cdr.detectChanges();
    }
  }
}
