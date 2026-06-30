import { waitForAsync, ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { ZipUploadComponent } from './zip-upload.component';
import { UserService } from '../user.service';
import { APIService } from '../api.service';
import { ToastrService } from 'ngx-toastr';

describe('ZipUploadComponent', () => {
  let component: ZipUploadComponent;
  let fixture: ComponentFixture<ZipUploadComponent>;

  const mockUserService = {
    user: of({ token: 'mock-token', name: 'Mock User' }),
    logout: () => {}
  };

  const mockAPIService = {
    importZip: () => of({ kind: 'UploadFinished', errors: [] }),
    importDocuments: () => of({ kind: 'UploadFinished', errors: [] }),
    importSources: () => of({ kind: 'UploadFinished', errors: [] }),
    deleteDocuments: () => of({ kind: 'UploadFinished', errors: [] }),
    deleteSources: () => of({ kind: 'UploadFinished', errors: [] }),
  };

  const mockToastrService = {
    error: () => {},
    success: () => {},
    info: () => {},
    warning: () => {}
  };

  beforeEach(waitForAsync(() => {
    TestBed.configureTestingModule({
      declarations: [ ZipUploadComponent ],
      providers: [
        { provide: UserService, useValue: mockUserService },
        { provide: APIService, useValue: mockAPIService },
        { provide: ToastrService, useValue: mockToastrService }
      ]
    })
    .compileComponents();
  }));

  beforeEach(() => {
    fixture = TestBed.createComponent(ZipUploadComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
