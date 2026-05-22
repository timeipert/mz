import { async, ComponentFixture, TestBed } from '@angular/core/testing';

import { EditSyllableTextComponent } from './edit-syllable-text.component';

describe('EditSyllableTextComponent', () => {
  let component: EditSyllableTextComponent;
  let fixture: ComponentFixture<EditSyllableTextComponent>;

  beforeEach(async(() => {
    TestBed.configureTestingModule({
      declarations: [ EditSyllableTextComponent ]
    })
    .compileComponents();
  }));

  beforeEach(() => {
    fixture = TestBed.createComponent(EditSyllableTextComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
