import { initSystem } from "./initSystem.js";

const goal = process.argv.slice(2).join(" ") || "analyze project";

async function main() {
  const { runtime } = initSystem();
  const res = await runtime.run(goal);

  console.error(JSON.stringify(res, null, 2));
}

main();
