import { async, ComponentFixture, TestBed } from '@angular/core/testing';

import { FolioChangeComponent } from './folio-change.component';

describe('FolioChangeComponent', () => {
  let component: FolioChangeComponent;
  let fixture: ComponentFixture<FolioChangeComponent>;

  beforeEach(async(() => {
    TestBed.configureTestingModule({
      declarations: [ FolioChangeComponent ]
    })
    .compileComponents();
  }));

  beforeEach(() => {
    fixture = TestBed.createComponent(FolioChangeComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
