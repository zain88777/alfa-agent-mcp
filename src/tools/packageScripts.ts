import fs from "fs/promises";

export async function packageScriptsToolHandler() {
  const data = await fs.readFile("package.json", "utf-8");
  const pkg = JSON.parse(data);

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(pkg.scripts || {}, null, 2)
      }
    ]
  };
}