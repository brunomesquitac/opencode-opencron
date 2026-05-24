import { join } from "path";
const distDir = join(process.cwd(), "dist", "gateway", "index.js");
const { main } = await import(distDir);
main().catch(console.error);
