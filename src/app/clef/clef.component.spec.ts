import { waitForAsync, ComponentFixture, TestBed } from '@angular/core/testing';

import { ClefComponent } from './clef.component';

describe('ClefComponent', () => {
  let component: ClefComponent;
  let fixture: ComponentFixture<ClefComponent>;

  beforeEach(waitForAsync(() => {
    TestBed.configureTestingModule({
      declarations: [ ClefComponent ]
    })
    .compileComponents();
  }));

  beforeEach(() => {
    fixture = TestBed.createComponent(ClefComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
