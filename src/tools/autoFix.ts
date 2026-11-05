export async function autoFixToolHandler(input: {
  error: string;
}) {
  const fixes: string[] = [];

  if (/TS2769/.test(input.error)) fixes.push("Fix overload or schema mismatch");
  if (/TS18003/.test(input.error)) fixes.push("Ensure src folder has files");
  if (/Cannot find module/.test(input.error)) fixes.push("Check import path + install package");

  return {
    content: [
      {
        type: "text" as const,
        text: fixes.length ? fixes.join("\n") : "No auto-fix rule matched"
      }
    ]
  };
}
