import { app } from 'electron';
import { writeFile } from 'node:fs/promises';

const output = process.env.AGENTBASE_SCREENSHOT_PATH;
if (!output) throw new Error('Set AGENTBASE_SCREENSHOT_PATH.');

app.on('browser-window-created', (_event, window) => {
  window.webContents.on('did-finish-load', async () => {
    try {
      for (let attempt = 0; attempt < 40; attempt++) {
        const count = await window.webContents.executeJavaScript("document.querySelector('#graph-count')?.textContent || ''");
        if (count.includes('nodes')) {
          const image = await window.capturePage();
          await writeFile(output, image.toPNG());
          app.quit();
          return;
        }
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      throw new Error('The graph did not load before the screenshot timeout.');
    } catch (error) {
      console.error(error);
      app.exit(1);
    }
  });
});

await import('./main.mjs');
