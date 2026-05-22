import { EventEmitter, Input, Output, OnInit, Directive } from '@angular/core';
import * as Model from '../types/model';
import * as MS from '../types/modelStorage';
import { Event } from './Event';
import { DragRequest } from '../dragger/dragger.component';
import { UndoService } from '../undoService';

@Directive()
export abstract class Section<T extends Model.Container> implements OnInit {
  constructor(
    public name: string,
    public eventHandlers: EventHandlers,
    public undo: UndoService,
  ) {
  }

  public actionHandlers: { [name: string]: (() => void) } = {};
  private defaultActions: { [name: string]: (() => void) } = {
    'Kopieren': () => MS.store({
      data: this.data,
      oldDepth: this.zipper.length,
      partOf: this.documentType
    }),
    'Auf dieser Ebene einfügen': () => {
      this.undo.beforeChange();
      this.onEvent.emit({
        kind: "PasteRequested",
        at: this.zipper.concat([]),
        withoutText: false,
        withoutNotes: false,
      })
    },
    'Auf dieser Ebene einfügen (ohne Noten)': () => {
      this.undo.beforeChange();
      this.onEvent.emit({
        kind: "PasteRequested",
        at: this.zipper.concat([]),
        withoutText: false,
        withoutNotes: true,
      })
    },
    'Auf dieser Ebene einfügen (ohne Text)': () => {
      this.undo.beforeChange();
      this.onEvent.emit({
        kind: "PasteRequested",
        at: this.zipper.concat([]),
        withoutText: true,
        withoutNotes: false,
      })
    }
  };

  ngOnInit() {
  }

  isDragTarget = false;

  @Input()
  readOnly!: boolean;

  @Input()
  data!: T;

  @Input()
  comments!: Model.Comment[];

  @Input()
  documentType!: Model.DocumentType;

  @Input()
  zipper!: number[];

  @Output()
  onEvent = new EventEmitter<Event>();

  actions(): string[] {
    const actions = Object.keys(this.actionHandlers);
    for (let da of Object.keys(this.defaultActions)) {
      if (actions.indexOf(da) === -1) {
        actions.push(da);
      }
    }
    return actions;
  }

  executeAction(a: string): void {
    if (this.actionHandlers[a]) {
      this.actionHandlers[a]();
    } else if (this.defaultActions[a]) {
      this.defaultActions[a]();
    } else {
      throw new Error("unknown action " + a);
    }
  }

  getZipper(n: number): number[] {
    return [...this.zipper, n]
  }

  canBeDeleted(): boolean {
    return true;
  }

  handleEvent(e: Event, childIndex: number) {
    if (this.eventHandlers[e.kind]) {
      this.eventHandlers[e.kind]!(e as any, childIndex);
    } else {
      this.onEvent.emit(e);
    }
  }

  onDropRequested(d: DragRequest): void {
    this.handleEvent({
      kind: 'MoveRequested',
      from: d.from,
      to: d.to
    }, -1);
  }

  getChildren(): Model.Container[] {
    return Model.getContainerChildren(this.data);
  }

  getUUID = (_: any, x: any) => Model.getUUID(x);

  kindIs(x: any, y: any) {
    return x.kind === y;
  }
}

type EventHandlers = {
  [kind in Event["kind"]]?: (e: Extract<Event, { kind: kind }>, index: number) => void
};
