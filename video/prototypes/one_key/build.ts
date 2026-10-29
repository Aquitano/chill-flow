export {};
const build = await Bun.build({entrypoints: ["preview.ts"], target: "browser", minify: true});
if (!build.success) throw new Error("Preview compilation failed");
const fontData = Buffer.from(await Bun.file("assets/Terminal.ttf").arrayBuffer()).toString("base64");
const code = (await build.outputs[0].text()).replaceAll("assets/Terminal.ttf", `data:font/ttf;base64,${fontData}`);
await Bun.write("preview.html", `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>One key</title><style>body{margin:0;background:#14141e;color:#cdd6f4;font:14px monospace}main{max-width:1280px;margin:24px auto;padding:0 20px}canvas{width:100%;height:auto;display:block}nav{display:flex;gap:14px;align-items:center;padding:16px 0}input{flex:1;accent-color:#cdd6f4}button{font:inherit;padding:6px 15px}output{min-width:100px}</style><main><canvas width="1920" height="1080"></canvas><nav><button>Play</button><input aria-label="Frame" type="range" min="0" max="329" value="0"><output></output></nav></main><script type="module">${code}</script></html>`);
