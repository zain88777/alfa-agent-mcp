import { getSourceFiles } from "../ast/astProject.js";

export async function astProjectFilesToolHandler() {
  const files = getSourceFiles().map((file) => file.fileName);

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(files, null, 2)
      }
    ]
  };
}
