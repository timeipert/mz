import { async, ComponentFixture, TestBed } from '@angular/core/testing';

import { ParatextCommentComponent } from './paratext-comment.component';

describe('ParatextCommentComponent', () => {
  let component: ParatextCommentComponent;
  let fixture: ComponentFixture<ParatextCommentComponent>;

  beforeEach(async(() => {
    TestBed.configureTestingModule({
      declarations: [ ParatextCommentComponent ]
    })
    .compileComponents();
  }));

  beforeEach(() => {
    fixture = TestBed.createComponent(ParatextCommentComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
