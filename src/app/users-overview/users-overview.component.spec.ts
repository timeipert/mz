import { waitForAsync, ComponentFixture, TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { RouterTestingModule } from '@angular/router/testing';
import { of } from 'rxjs';
import { UsersOverviewComponent } from './users-overview.component';
import { APIService } from '../api.service';
import { UserService } from '../user.service';
import { ToastrService } from 'ngx-toastr';

describe('UsersOverviewComponent', () => {
  let component: UsersOverviewComponent;
  let fixture: ComponentFixture<UsersOverviewComponent>;

  const mockAPIService = {
    listUsers: () => of({ kind: 'UserInfosRetrieved', infos: [] }),
    createUser: () => of({ kind: 'Ok' }),
    removeUser: () => of({ kind: 'Ok' })
  };

  const mockUserService = {
    user: of({ token: 'mock-token', name: 'Mock User' }),
    logout: () => {}
  };

  const mockToastrService = {
    error: () => {},
    success: () => {},
    info: () => {},
    warning: () => {}
  };

  beforeEach(waitForAsync(() => {
    TestBed.configureTestingModule({
      declarations: [ UsersOverviewComponent ],
      imports: [ FormsModule, RouterTestingModule ],
      providers: [
        { provide: APIService, useValue: mockAPIService },
        { provide: UserService, useValue: mockUserService },
        { provide: ToastrService, useValue: mockToastrService }
      ]
    })
    .compileComponents();
  }));

  beforeEach(() => {
    fixture = TestBed.createComponent(UsersOverviewComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
