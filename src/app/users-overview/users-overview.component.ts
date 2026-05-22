import { Component, OnInit, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { UserService, User } from '../user.service';
import { APIService, UserInfo } from '../api.service'
import { ToastrService } from 'ngx-toastr';
import { assertNever } from '../../utils';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-users-overview',
  templateUrl: './users-overview.component.html',
  styleUrls: ['./users-overview.component.css']
})
export class UsersOverviewComponent implements OnInit, OnDestroy {
  userServiceSub: Subscription | null = null;
  user: User | null = null;
  userInfo: UserInfo[] = [];
  mail: string = "";
  password: string = "";
  creationError: boolean = false;
  deletionError: boolean = false;

  constructor(private api: APIService, private userService: UserService, private router: Router, private toastr: ToastrService) { }

  ngOnInit() {
    this.userServiceSub = this.userService.user.subscribe(u => {
      this.user = u;
      this.updateList();
    });
  }

  ngOnDestroy() {
    if (this.userServiceSub) {
      this.userServiceSub.unsubscribe();
    }
  }

  updateList(): void {
    if (this.user) {
      this.api.listUsers(this.user.token).subscribe(res => {
        switch (res.kind) {
          case 'LoginRequired': this.userService.logout(); break;
          case 'InsufficientPermissions': this.router.navigate(['/login']); break;
          case 'UserInfosRetrieved': this.userInfo = res.infos; break;
          default: assertNever(res);
        }
      });
    }
  }

  createUser(): void {
    if (this.user) {
      this.api.createUser(this.user.token, this.mail, this.password).subscribe(res => {
        switch (res.kind) {
          case 'LoginRequired': this.userService.logout(); break;
          case 'InsufficientPermissions': this.router.navigate(['/login']); break;
          case 'InvalidUsernameFormat': this.toastr.error("Nutzername muss eine Email Adresse sein.", "Erstellung Fehlgeschlagen"); break;
          case 'UserAlreadyExists': this.toastr.error("Dieser Nutzer existiert bereits.", "Erstellung Fehlgeschlagen"); break;
          case 'Ok': this.updateList(); this.clearAll(); break;
          default: assertNever(res);
        }
      });
    }
  }

  clearAll(): void {
    this.mail = "";
    this.password = "";
  }


  removeUser(username: string): void {
    if (this.user) {
      this.api.removeUser(this.user.token, username).subscribe(res => {
        switch (res.kind) {
          case 'LoginRequired': this.userService.logout(); break;
          case 'InsufficientPermissions': this.router.navigate(['/login']); break;
          case 'InvalidUsernameFormat': this.toastr.error("Nutzername muss eine Email Adresse sein.", "Löschen fehlgeschlagen"); break;
          case 'TriedToRemoveSelf': this.toastr.error("Man kann sich nicht selbst löschen.", "Löschen fehlgeschlagen"); break;
          case 'Ok': this.updateList(); this.clearAll(); break;
          default: assertNever(res);
        }
      });
    }
  }
}
