import fs from "fs";
import path from "path";

const root = process.cwd();
const toolsDir = path.join(root, "src", "tools");
const outFile = path.join(root, "src", "core", "toolLoader.ts");

function toCamel(file) {
  return file.replace(/\.ts$/, "").replace(/[^a-zA-Z0-9]+(.)/g, (_, c) => c.toUpperCase());
}

function toSnake(name) {
  return name.replace(/([A-Z])/g, "_$1").toLowerCase().replace(/^_/, "");
}

const files = fs
  .readdirSync(toolsDir)
  .filter((file) => file.endsWith(".ts"))
  .sort();

const imports = [];
const registers = [];

for (const file of files) {
  const base = file.replace(/\.ts$/, "");
  const camel = toCamel(file);
  const handler = `${camel}ToolHandler`;
  const toolName = toSnake(camel);

  imports.push(`import { ${handler} } from "../tools/${base}.js";`);
  registers.push(`  registry.register("${toolName}", ${handler});`);
}

const content = `import { ToolRegistry } from "./toolRegistry.js";

${imports.join("\n")}

export function loadTools(registry: ToolRegistry) {
${registers.join("\n")}
}
`;

fs.writeFileSync(outFile, content, "utf-8");
console.log(`Generated ${outFile} with ${files.length} tools.`);