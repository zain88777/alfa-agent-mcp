import { getSourceFiles } from "./astProject.js";

export function buildImpactGraph(targetFile: string) {
  const files = getSourceFiles();
  const impacted: string[] = [];

  for (const file of files) {
    if (file.fileName === targetFile) continue;

    if (
      file.text.includes(targetFile) ||
      file.text.includes(targetFile.replace(/\\/g, "/"))
    ) {
      impacted.push(file.fileName);
    }
  }

  return impacted;
}