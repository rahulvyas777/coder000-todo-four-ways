import { Directive, ElementRef, afterNextRender, inject } from '@angular/core';

/** Focuses (and selects) an inline editor as soon as it is rendered. */
@Directive({ selector: 'input[appAutofocus]' })
export class Autofocus {
  constructor() {
    const el = inject<ElementRef<HTMLInputElement>>(ElementRef).nativeElement;
    afterNextRender(() => {
      el.focus();
      el.select();
    });
  }
}
