export class Input {
  readonly keys = new Set<string>();

  constructor() {
    window.addEventListener("keydown", (e) => {
      this.keys.add(e.code);
      if (
        ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(
          e.code,
        )
      ) {
        e.preventDefault();
      }
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));
    window.addEventListener("blur", () => this.keys.clear());
  }

  pressed(...codes: string[]): boolean {
    return codes.some((c) => this.keys.has(c));
  }
}
