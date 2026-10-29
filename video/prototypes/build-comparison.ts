import { join } from "node:path";

const root = import.meta.dir;
const result = await Bun.build({ entrypoints:[join(root,"comparison.ts")], target:"browser", minify:true });
if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
const sources: {family:string;file:string}[] = await Bun.file(join(root,"review-assets/fonts.json")).json();
const fonts = await Promise.all(sources.map(async source => ({
  family:source.family,
  url:`data:font/woff2;base64,${Buffer.from(await Bun.file(join(root,source.file)).arrayBuffer()).toString("base64")}`,
})));
const script = await result.outputs[0].text();
const template = await Bun.file(join(root,"comparison-template.html")).text();
const html = template.replace("__FONTS__",JSON.stringify(fonts)).replace("/* COMPARISON_SCRIPT */",script.replaceAll("</script","<\\/script"));
await Bun.write(join(root,"comparison.html"),html);
console.log(`Built four-study player (${html.length} characters).`);
