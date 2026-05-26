import { ComponentFixture, TestBed } from '@angular/core/testing';

import { IiifViewerComponent } from './iiif-viewer.component';

describe('IiifViewerComponent', () => {
  let component: IiifViewerComponent;
  let fixture: ComponentFixture<IiifViewerComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      declarations: [IiifViewerComponent]
    });
    fixture = TestBed.createComponent(IiifViewerComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
