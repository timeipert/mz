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

  @Input()
  filterable: boolean = true;

  @Input()
  paginated: boolean = true;

  @Input()
  pageSize: number = 10;

  @Output()
  onRowClick = new EventEmitter<T>();

  @Output()
  onDelete = new EventEmitter<T>();

  sortFieldName: string | undefined = undefined;
  sortDescending = false;

  filterText = '';
  currentPage = 1;

  allRows: Row<T>[] = [];
  filteredRows: Row<T>[] = [];
  pagedRows: Row<T>[] = [];

  constructor() { }

  ngOnInit() {
  }

  ngOnChanges(changes: SimpleChanges) {
    let structureChanged = false;
    
    if (changes['headers']) {
      const prev = changes['headers'].previousValue as Header<T>[] | undefined;
      const curr = changes['headers'].currentValue as Header<T>[] | undefined;
      if (!prev || !curr || prev.length !== curr.length || prev.some((h, i) => h.name !== curr[i].name)) {
        structureChanged = true;
      }
    }

    if (structureChanged) {
      this.sortFieldName = undefined;
      this.sortDescending = false;
      this.currentPage = 1;
    }

    this.allRows = this.objects.map(o => ({
      dataObject: o,
      cells: this.headers.map(h => h.makeCell(o))
    }));

    if (this.sortFieldName !== undefined) {
      const h = this.headers.find(x => x.name === this.sortFieldName);
      if (h) {
        const index = this.headers.indexOf(h);
        const multiplier = this.sortDescending ? -1 : 1;
        this.allRows.sort((a, b) => {
          const first = (a.cells[index].text || '').toString().toLowerCase();
          const second = (b.cells[index].text || '').toString().toLowerCase();
          return multiplier * (first < second ? -1 : first > second ? +1 : 0);
        });
      }
    }

    this.applyFilterAndPagination();
  }

  sortBy(h: Header<T>) {
    const index = this.headers.indexOf(h);
    if (this.sortFieldName === h.name) {
      if (this.sortDescending) {
        this.sortFieldName = undefined;
        this.sortDescending = false;
        this.allRows = this.objects.map(o => ({
          dataObject: o,
          cells: this.headers.map(h => h.makeCell(o))
        }));
      } else {
        this.sortDescending = true;
      }
    } else {
      this.sortDescending = false;
      this.sortFieldName = h.name;
    }

    if (this.sortFieldName !== undefined) {
      const multiplier = this.sortDescending ? -1 : 1;
      this.allRows.sort((a, b) => {
        const first = (a.cells[index].text || '').toString().toLowerCase();
        const second = (b.cells[index].text || '').toString().toLowerCase();
        return multiplier * (first < second ? -1 : first > second ? +1 : 0);
      });
    }

    this.applyFilterAndPagination();
  }

  applyFilterAndPagination() {
    // 1. Filtering
    if (this.filterable && this.filterText.trim()) {
      const q = this.filterText.toLowerCase();
      this.filteredRows = this.allRows.filter(row =>
        row.cells.some(cell => (cell.text || '').toString().toLowerCase().includes(q))
      );
    } else {
      this.filteredRows = [...this.allRows];
    }

    // 2. Pagination
    if (this.paginated) {
      const maxPage = Math.max(1, Math.ceil(this.filteredRows.length / this.pageSize));
      if (this.currentPage > maxPage) {
        this.currentPage = maxPage;
      }
      const start = (this.currentPage - 1) * this.pageSize;
      this.pagedRows = this.filteredRows.slice(start, start + this.pageSize);
    } else {
      this.pagedRows = [...this.filteredRows];
    }
  }

  setPage(page: number) {
    if (page < 1 || page > this.totalPages) return;
    this.currentPage = page;
    this.applyFilterAndPagination();
  }

  get totalPages(): number {
    return Math.ceil(this.filteredRows.length / this.pageSize);
  }

  get startRow(): number {
    return (this.currentPage - 1) * this.pageSize;
  }

  get endRow(): number {
    const end = this.currentPage * this.pageSize;
    return end > this.filteredRows.length ? this.filteredRows.length : end;
  }

  get pageNumbers(): number[] {
    const pages: number[] = [];
    for (let i = 1; i <= this.totalPages; i++) {
      pages.push(i);
    }
    return pages;
  }

  rowClicked(t: T) {
    this.onRowClick.emit(t);
  }

  requestDelete(t: T) {
    this.onDelete.emit(t);
  }
}

export type Cell = TextCell | LinkCell | BadgeCell;

export interface TextCell {
  kind: "text";
  text: string;
}

export interface LinkCell {
  kind: "link";
  text: string;
  href: string;
}

export interface BadgeCell {
  kind: "badge";
  text: string;
}

export interface Header<T> {
  name: string;
  makeCell(data: T): Cell;
}

export interface Row<T> {
  dataObject: T;
  cells: Cell[];
}
