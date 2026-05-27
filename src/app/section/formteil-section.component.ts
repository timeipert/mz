import { ChangeDetectorRef, OnChanges, ViewChildren, QueryList, Component } from '@angular/core';
import * as S from './Section';
import * as Model from '../types/model';
import { Event, NewNoteLineRequsted } from './Event';
import { FocusShiftRequested, DeletionRequested } from '../types/CommonEvent';
import { handleFocusShiftFromChild, handleFocusChangeFromParent } from '../../utils';
import { Focusable, FocusChange } from "../types/Focus";
import { UndoService } from '../undoService';

@Component({
  selector: 'app-formteil-section',
  templateUrl: './section.component.html',
  styleUrls: ['./section.component.scss']
})
export class FormteilSectionComponent extends S.Section<Model.FormteilContainer> implements OnChanges, Focusable {
  @ViewChildren("sub")
  children!: QueryList<Focusable>;

  deleteData(i: number): void {
    this.undo.beforeChange();
    this.data.data.splice(i, 1)
  }

  addData(newName: string): void {
    this.undo.beforeChange();
    let newData = { name: newName, data: "" };
    this.data.data.push(newData as Model.FormteilData);
  }

  setFormControl(e: string, index: number): void {
    this.undo.beforeChange();
    this.data.data[index].data = e;
  }

  getFormControlData(index: number): string {
    return this.data.data[index].data
  }

  constructor(private cdr: ChangeDetectorRef, undo: UndoService) {
    super("Formteil", {
      'NewNoteLineRequsted': (e: Event, oldIndex: number) => {
        undo.beforeChange();
        let r = e as NewNoteLineRequsted;
        this.newAt(r.container, oldIndex + 1);
      },
      'NewParatextRequested': (e: Event, oldIndex: number) => { undo.beforeChange(); this.newAt(Model.emptyParatextContainer(), oldIndex + 1); },
      'DeletionRequested': (e: Event, oldIndex: number) => { undo.beforeChange(); this.deletionRequest(e as DeletionRequested, oldIndex) },
      'FocusShiftRequested': (e: Event, oldIndex: number) => this.focusShiftRequest(e as FocusShiftRequested, oldIndex),
      // A child container is requesting a new PEER sibling (same depth as itself).
      // This FormteilContainer is the parent — it creates the new child at `oldIndex + 1`.
      // Using this.zipper.concat([oldIndex+1]) keeps the depth correct.
      // Without this handler the event bubbles to the root which always creates depth-1 containers.
      'NewFormteilRequested': (e: Event, oldIndex: number) => {
        undo.beforeChange();
        this.newAt(
          Model.emptyFormteilContainer(this.documentType, this.zipper.concat([oldIndex + 1])),
          oldIndex + 1
        );
      },
    }, undo);
  }

  focusShiftRequest(e: FocusShiftRequested, oldIndex: number): void {
    if (this.children.get(oldIndex + e.direction)) {
      handleFocusShiftFromChild(e as FocusShiftRequested, this.children.toArray(), oldIndex, (e) => this.onEvent.emit(e));
    } else {
      this.onEvent.emit({ kind: 'LineFocusShiftRequest', uuid: this.data.uuid, direction: e.direction });
    }
  }

  deletionRequest(e: DeletionRequested, oldIndex: number): void {
    this.data.children.splice(oldIndex, 1); this.onEvent.emit({ kind: 'StaleCommentRemovealRequested' });
    if (this.data.children.length > 0) {
      if (oldIndex >= this.data.children.length) {
        if (e.focusLast) {
          this.children.toArray()[this.data.children.length - 1].focus({ focusLast: true });
        }
      } else if (oldIndex === 0) {
        if (!e.focusLast) {
          this.children.toArray()[1].focus({ focusLast: false });
        }
      } else {
        this.children.toArray()[oldIndex].focus({ focusLast: e.focusLast });
      }
    }
  }

  ngOnChanges(): void {

    this.actionHandlers = {};

    const docStruct = Model.getStructure(this.documentType);
    const structure = docStruct[this.zipper.length - 1];
    const currentLevelNum = this.zipper.length;
    
    // 1. Add line (Most specific)
    if (structure && structure.canHaveLines) {
      this.actionHandlers['+ Line'] = () => this.newAt(Model.emptyZeileContainer(), 0);
    }

    // 2. Add section (Peer level)
    this.actionHandlers['+ L' + currentLevelNum] = () => this.onEvent.emit({ 'kind': 'NewFormteilRequested' });

    // 3. Add sub section (Child level)
    const nextLevel = docStruct[this.zipper.length];
    if (nextLevel) {
      this.actionHandlers['+ L' + (currentLevelNum + 1)] = () => this.newAt(Model.emptyFormteilContainer(this.documentType, this.zipper.concat([0])), 0);
    }
    
    // 4. Add paratext (Additional metadata/text)
    this.actionHandlers['+ Text'] = () => { this.newAt(Model.emptyParatextContainer(), 0) };

  }

  getName(): string {
    const docStruct = Model.getStructure(this.documentType);
    const structure = docStruct[this.zipper.length - 1];
    return (structure && structure.name) || "";
  }

  getLevelName(): string {
    if (!this.levelNames) return "";
    const depth = this.zipper.length;
    if (depth === 1) return this.levelNames.level1 || "";
    if (depth === 2) return this.levelNames.level2 || "";
    if (depth === 3) return this.levelNames.level3 || "";
    return "";
  }

  newAt(model: Model.FormteilChildren, newIndex: number) {
    this.undo.beforeChange();
    this.data.children.splice(newIndex, 0, model);
    setTimeout(() => this.children.toArray().find(sft => sft.getData() === model)!.focus({ focusLast: false }), 0);
  }

  focus(change: FocusChange): void {
    handleFocusChangeFromParent(change, this.children.toArray());
  }

  getData(): any {
    return this.data;
  }

  setReference(value: boolean): void {
    (this.data as any).data.reference = value ? '' : undefined;
  }

  newDataName: Model.FormteilDataName[] = (() => {
    const nameObject: { [N in Model.FormteilDataName]: number } = {
      Signatur: 1,
      Status: 2,
      Verweis: 3,
      LemmatisiertesTextInitium: 4,
    }

    const ret = Object.keys(nameObject) as Model.FormteilDataName[];
    ret.sort((a, b) => nameObject[a] - nameObject[b]);
    return ret;
  })()

}
