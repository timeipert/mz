import { Output, EventEmitter, SimpleChanges, Input, OnChanges, Component, OnInit } from '@angular/core';

@Component({
  selector: 'app-smart-table',
  templateUrl: './smart-table.component.html',
  styleUrls: ['./smart-table.component.css']
})
export class SmartTableComponent<T> implements OnInit, OnChanges {
  @Input()
  objects: T[] = [];

  @Input()
  headers: Header<T>[] = [];

  @Input()
  canDelete: boolean = false;

  @Output()
  onRowClick = new EventEmitter<T>();

  @Output()
  onDelete = new EventEmitter<T>();

  sortFieldName: string | undefined = undefined;
  sortDescending = false;

  rows: Row<T>[] = [];

  constructor() { }

  ngOnInit() {
  }

  ngOnChanges() {
    this.rows = recalculate(this.objects, this.headers);
    this.sortFieldName = undefined;
    this.sortDescending = false;
  }

  sortBy(h: Header<T>) {
    const index = this.headers.indexOf(h);
    if (this.sortFieldName === h.name) {
      if (this.sortDescending) {
        this.rows = recalculate(this.objects, this.headers);
        this.sortFieldName = undefined;
        return;
      } else {
        this.sortDescending = true;
      }
    } else {
      this.sortDescending = false;
      this.sortFieldName = h.name;
    }

    const multiplier = this.sortDescending ? -1 : 1;

    this.rows.sort((a, b) => {
      const first = a.cells[index].text;
      const second = b.cells[index].text;
      return multiplier * (first < second ? -1 : first > second ? +1 : 0);
    });
  }

  rowClicked(t: T) {
    this.onRowClick.emit(t);
  }

  requestDelete(t: T) {
    this.onDelete.emit(t);
  }
}

function recalculate<T>(objects: T[], headers: Header<T>[]): Row<T>[] {
  return objects.map(o => ({ dataObject: o, cells: headers.map(h => h.makeCell(o))}));
}


export type Cell = TextCell | LinkCell;

export interface TextCell {
  kind: "text";
  text: string;
}

export interface LinkCell {
  kind: "link";
  text: string;
  href: string;
}

export interface Header<T> {
  name: string;
  makeCell(data: T): Cell;
}

export interface Row<T> {
  dataObject: T;
  cells: Cell[];
}
