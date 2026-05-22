
import { DocumentComponent } from './document/document.component';

export class ConfirmDeactivateGuard  {

  canDeactivate(target: DocumentComponent) {
    if(target.hasChanges()){
        return window.confirm('Wollen Sie wirklich fortfahren?\nSie haben noch nicht gespeicherte Änderungen.');
    }
    return true;
  }
}