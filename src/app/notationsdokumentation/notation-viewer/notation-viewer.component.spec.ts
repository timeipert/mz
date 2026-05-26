import { ComponentFixture, TestBed } from '@angular/core/testing';

import { NotationViewerComponent } from './notation-viewer.component';

describe('NotationViewerComponent', () => {
  let component: NotationViewerComponent;
  let fixture: ComponentFixture<NotationViewerComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      declarations: [NotationViewerComponent]
    });
    fixture = TestBed.createComponent(NotationViewerComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
