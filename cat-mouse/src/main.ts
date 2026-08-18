import { App } from './app';

/**
 * Mounts canvas#stage and starts the app.
 * Default path: title → story → chapter 1 → stage 1 (Enter through each screen).
 */
async function main(): Promise<void> {
  const canvas = document.getElementById('stage');
  if (!(canvas instanceof HTMLCanvasElement)) {
    throw new Error('Missing canvas#stage');
  }
  canvas.tabIndex = 0;
  const app = await App.create(canvas);
  app.prepareStoryPath();
  app.start();
  canvas.focus();
}

void main();
