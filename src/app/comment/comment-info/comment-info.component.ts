import { Component } from '@angular/core';

@Component({
  selector: 'app-comment-info',
  templateUrl: './comment-info.component.html',
  styleUrls: ['./comment-info.component.scss']
})
export class CommentInfoComponent {
  public isOpen = false;

  toggleOpen() {
    this.isOpen = !this.isOpen;
  }
}
