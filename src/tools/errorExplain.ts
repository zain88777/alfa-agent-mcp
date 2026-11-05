export async function errorExplainToolHandler(input: { errorText: string }) {
  const text = input.errorText;

  const hints: string[] = [];

  if (/TS2769/.test(text)) hints.push("TS2769: Function overload mismatch. Check argument order and schema types.");
  if (/TS18003/.test(text)) hints.push("TS18003: TypeScript found no input files. Check src folder and tsconfig include.");
  if (/Cannot find module/i.test(text)) hints.push("Missing module/import. Check package install, file path, and .js extension for ESM imports.");
  if (/not assignable to type/i.test(text)) hints.push("Type mismatch. Check literal types, return types, and inferred string vs const values.");
  if (/Access denied/i.test(text)) hints.push("Safe path guard blocked access outside workspace.");
  if (/ENOENT/i.test(text)) hints.push("File or folder not found. Check path spelling and working directory.");

  return {
    content: [
      {
        type: "text" as const,
        text: hints.length ? hints.join("\n") : "No known hint matched. Review full stack trace and line number."
      }
    ]
  };
}