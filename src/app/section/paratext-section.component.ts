import { ViewChild, ElementRef, Component, OnInit } from '@angular/core';
import { FocusService } from '../focus.service';
import * as S from './Section';
import * as Model from '../types/model';
import { Focusable, FocusChange, Focus, handleTextInputMove } from '../types/Focus';
import { assertNever, focusContentEditable } from '../../utils';
import { ParatextCommentComponent } from '../paratext-comment/paratext-comment.component';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { Observable } from 'rxjs';
import { take } from 'rxjs/operators';
import { UndoService } from '../undoService';

@Component({
  selector: 'app-paratext-section',
  templateUrl: './section.component.html',
  styleUrls: ['./section.component.scss']
})
export class ParatextSectionComponent extends S.Section<Model.ParatextContainer> implements OnInit, Focusable {
  @ViewChild('paratextInput', { static: false }) paratext!: ElementRef;
  @ViewChild('commentModal', { static: true }) commentModal!: ElementRef;
  types = Object.keys(Model.ParatextType);
  subscription!: Observable<Model.ParatextComment>;

  constructor(
    private focusService: FocusService,
    private modalService: NgbModal,
    private undoService: UndoService) {
    super('Paratext', {}, undoService);
  }

  ngOnInit(): void {
    this.actionHandlers = {
      'Neue Zeile': () => this.onEvent.emit({ 'kind': 'NewNoteLineRequsted', container: Model.emptyZeileContainer() }),
      'Neuer Paratext': () => this.onEvent.emit({ 'kind': 'NewParatextRequested' }),
      'Neuer Formteil': () => this.onEvent.emit({ 'kind': 'NewFormteilRequested' }),
      'Löschen': () => this.onEvent.emit({ 'kind': 'DeletionRequested', focusLast: true }),
    };
  }

  setParatextTextArea(e: string) {
    this.undoService.beforeChange();
    this.data.text = e;
  }

  setParaDetail(e: boolean) {
    this.undoService.beforeChange();
    this.data.retro = e;
  }

  setParaType(e: Model.ParatextType) {
    this.undoService.beforeChange();
    this.data.paratextType = e;
  }

  focus(change: FocusChange): void {
    const level = change.preferredLevel || this.focusService.preferredFocus;
    switch (level) {
      case Focus.Notes:
      case Focus.Code:
      case Focus.Text:
        focusContentEditable((this.paratext.nativeElement as HTMLElement), change.focusLast);
        break;
      default: assertNever(level);
    }
  }

  onKeyDown(event: KeyboardEvent): void {
    console.log(event);
    if (event.ctrlKey && event.key === 'z') {
      this.undoService.undo();
    } else {
      this.undoService.beforeChange();
      handleTextInputMove(this.paratext.nativeElement, event, e => this.onEvent.emit(e));
    }

  }

  showParaTextComment() {
    const modalRef = this.modalService.open(ParatextCommentComponent);
    modalRef.componentInstance.comment = this.data.comment || { alternativeText: this.data.text, certain: false, comment: '' };
    this.subscription = modalRef.componentInstance.updateParaTextComment;
    this.subscription.pipe(take(1)).subscribe((newComment: Model.ParatextComment) => this.data.comment = newComment);
  }

  getData(): any {
    return this.data;
  }
}

