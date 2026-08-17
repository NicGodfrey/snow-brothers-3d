import type { Scene, SceneContext } from '../engine/types';
import type { ChapterDef } from '../content/schema';
import { CHAPTERS } from '../content/chapters';
import { stageById, stagesOfChapter } from '../content/registry';
import type { App } from '../app';
import { Menu, menuBack, type MenuItem } from '../ui/menus';
import { screenCamera } from './boot';

export class ChapterMapScene implements Scene {
  readonly name = 'chapterMap';
  private readonly app: App;
  private chapters: ChapterDef[] = CHAPTERS.slice();
  private chapterIndex = 0;
  private stageIndex = 0;
  private focus: 'chapter' | 'stage' = 'stage';
  private menu: Menu | null = null;
  private readyAt = 0;

  constructor(app: App) {
    this.app = app;
  }

  enter(ctx: SceneContext): void {
    this.readyAt = ctx.clock.elapsed + 0.16;
    this.chapterIndex = Math.max(0, this.app.chapter - 1);
    this.stageIndex = Math.max(0, this.app.stageIndex - 1);
    this.focus = 'stage';
    void this.app.listChapters().then((chapters) => {
      if (chapters.length > 0) this.chapters = chapters;
      this.rebuild();
    });
    this.rebuild();
  }

  resume(ctx: SceneContext): void {
    this.enter(ctx);
  }

  exit(): void {
    this.app.overlay.clearMenu();
  }

  update(ctx: SceneContext): void {
    if (ctx.clock.elapsed < this.readyAt || !this.menu) return;
    if (menuBack(ctx.input)) {
      this.app.goModeSelect();
      return;
    }
    if (ctx.input.pressed('left') && this.focus === 'stage') {
      this.focus = 'chapter';
      this.rebuild();
      return;
    }
    if (ctx.input.pressed('right') && this.focus === 'chapter') {
      this.focus = 'stage';
      this.rebuild();
      return;
    }
    this.menu.handleInput(ctx.input);
  }

  render(ctx: SceneContext): void {
    const { renderer, width, height } = ctx;
    renderer.begin(screenCamera(width, height));
    renderer.clear('#120e0b');
    renderer.rect(0, 0, width, 8, '#c4a15a');
    renderer.end();
  }

  private rebuild(): void {
    const chapter = this.chapters[this.chapterIndex] ?? this.chapters[0];
    const extra = document.createElement('div');
    extra.className = 'chapter-grid';
    extra.append(this.column('Chapters', this.chapters.map((c) => c.title), this.chapterIndex, this.focus === 'chapter'));
    extra.append(
      this.column(
        chapter ? chapter.title : 'Stages',
        this.stageLabels(chapter),
        this.stageIndex,
        this.focus === 'stage',
      ),
    );

    const items: MenuItem[] =
      this.focus === 'chapter'
        ? this.chapters.map((chapterDef, i) => ({
            id: `ch-${chapterDef.index}`,
            label: `${chapterDef.index}. ${chapterDef.title}`,
            hint: i === 0 ? 'Unlocked' : 'Locked',
            disabled: i > 0,
            action: () => {
              this.chapterIndex = i;
              this.app.chapter = chapterDef.index;
              this.focus = 'stage';
              this.rebuild();
            },
          }))
        : this.stageLabels(chapter).map((name, i) => ({
            id: chapter?.stageIds[i] ?? `st-${i + 1}`,
            label: name,
            action: () => {
              this.stageIndex = i;
              this.app.chapter = chapter?.index ?? 1;
              this.app.stageIndex = i + 1;
              const id = chapter?.stageIds[i];
              void this.app.goPlay(this.app.chapter, this.app.stageIndex, id);
            },
          }));

    this.menu = new Menu(
      {
        kicker: 'Campaign',
        title: 'Chapter Map',
        blurb: chapter?.blurb ?? 'Choose a kitchen to raid.',
        extra,
        hint: 'Left/right switch lists · Enter plays the highlighted stage',
      },
      items,
      this.focus === 'chapter' ? this.chapterIndex : this.stageIndex,
    );
    this.app.overlay.setMenu(this.menu.element());
  }

  private stageLabels(chapter: ChapterDef | undefined): string[] {
    if (!chapter) return [];
    const authored = stagesOfChapter(chapter.index);
    if (authored.length > 0) {
      return authored.map((stage, i) => `${i + 1}. ${stage.name}`);
    }
    return chapter.stageIds.map((id, i) => {
      const named = stageById(id);
      if (named) return `${i + 1}. ${named.name}`;
      const tail = id.split('-').slice(2).join(' ').replace(/-/g, ' ');
      const pretty = tail.replace(/\b\w/g, (ch) => ch.toUpperCase());
      return `${i + 1}. ${pretty || `Stage ${i + 1}`}`;
    });
  }

  private column(title: string, labels: string[], selected: number, active: boolean): HTMLElement {
    const col = document.createElement('div');
    col.className = title.startsWith('Chapter') ? 'chapter-col' : 'stage-col';
    const h = document.createElement('h3');
    h.textContent = title;
    col.append(h);
    const list = document.createElement('ul');
    list.className = 'menu-list';
    for (let i = 0; i < labels.length; i += 1) {
      const li = document.createElement('li');
      li.className = 'menu-item';
      if (i === selected && active) li.classList.add('is-selected');
      li.textContent = labels[i] ?? '';
      list.append(li);
    }
    col.append(list);
    return col;
  }
}
