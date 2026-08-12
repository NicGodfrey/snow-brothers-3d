import type { ShellModel } from "../../../application/navigation-service.js";
import { html, type Html } from "../html.js";

export interface ErrorPageModel {
  readonly shell: ShellModel;
  readonly status: number;
  readonly code: string;
  readonly message: string;
}

export function errorPage(model: ErrorPageModel): Html {
  return html`
    <div class="page-head">
      <div>
        <h1>${model.status} · ${model.code}</h1>
        <p>${model.message}</p>
      </div>
    </div>
    <div class="card">
      <p>Try one of your modules from the rail, or go back to the <a href="/">overview</a>.</p>
    </div>
  `;
}
