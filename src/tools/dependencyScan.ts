import fs from "fs/promises";

export async function dependencyScanToolHandler() {
  const data = await fs.readFile("package.json", "utf-8");
  const pkg = JSON.parse(data);

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            packageName: pkg.name || null,
            dependencies: pkg.dependencies || {},
            devDependencies: pkg.devDependencies || {},
            scripts: pkg.scripts || {}
          },
          null,
          2
        )
      }
    ]
  };
}