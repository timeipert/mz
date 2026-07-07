import { ComponentFixture, TestBed } from '@angular/core/testing';
import { WelcomeComponent } from './welcome.component';
import { APIService } from '../api.service';
import { UserService } from '../user.service';
import { GithubService } from '../github.service';
import { PageTitleService } from '../page-title.service';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { ToastrService } from 'ngx-toastr';
import { of } from 'rxjs';
import { NO_ERRORS_SCHEMA } from '@angular/core';

describe('WelcomeComponent', () => {
  let component: WelcomeComponent;
  let fixture: ComponentFixture<WelcomeComponent>;

  const mockAPIService = {
    listSources: () => of({ kind: 'SourcesRetrieved', sources: [] as any[] }),
    listDocuments: () => of({ kind: 'DocumentsRetrieved', documents: [] as any[] }),
    storagePersisted: true
  };

  const mockUserService = {
    user: of({ token: 'mock-token', user: 'local-user', roles: ['admin'] })
  };

  const mockGithubService = {
    config: null
  };

  const mockPageTitleService = {
    reset: () => {}
  };

  const mockModalService = {
    open: () => {}
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      declarations: [WelcomeComponent],
      providers: [
        { provide: APIService, useValue: mockAPIService },
        { provide: UserService, useValue: mockUserService },
        { provide: GithubService, useValue: mockGithubService },
        { provide: PageTitleService, useValue: mockPageTitleService },
        { provide: NgbModal, useValue: mockModalService },
        { provide: ToastrService, useValue: { success: () => {}, warning: () => {}, error: () => {} } }
      ],
      schemas: [NO_ERRORS_SCHEMA]
    });

    fixture = TestBed.createComponent(WelcomeComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should initialize with default states', () => {
    expect(component.loading).toBeTrue();
    expect(component.hasData).toBeFalse();
    expect(component.sourcesCount).toBe(0);
    expect(component.documentsCount).toBe(0);
  });

  it('should calculate formatBytes correctly', () => {
    expect(component.formatBytes(0)).toBe('0 B');
    expect(component.formatBytes(1024)).toBe('1 KB');
    expect(component.formatBytes(1048576)).toBe('1 MB');
    expect(component.formatBytes(undefined)).toBe('0 B');
  });

  it('should detect when workspace contains data', () => {
    spyOn(mockAPIService, 'listSources').and.returnValue(
      of({ kind: 'SourcesRetrieved', sources: [{ id: 'src-1' } as any] })
    );
    fixture.detectChanges();
    expect(component.sourcesCount).toBe(1);
    expect(component.hasData).toBeTrue();
    expect(component.loading).toBeFalse();
  });
});
