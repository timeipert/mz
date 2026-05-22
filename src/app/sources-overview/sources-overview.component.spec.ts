import { async, ComponentFixture, TestBed } from '@angular/core/testing';

import { SourcesOverviewComponent } from './sources-overview.component';

describe('SourcesOverviewComponent', () => {
  let component: SourcesOverviewComponent;
  let fixture: ComponentFixture<SourcesOverviewComponent>;

  beforeEach(async(() => {
    TestBed.configureTestingModule({
      declarations: [ SourcesOverviewComponent ]
    })
    .compileComponents();
  }));

  beforeEach(() => {
    fixture = TestBed.createComponent(SourcesOverviewComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
