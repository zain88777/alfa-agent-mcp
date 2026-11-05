export async function agentChecklistToolHandler(input: {
  task: string;
  files?: string[];
}) {
  const checklist = {
    task: input.task,
    files: input.files ?? [],
    requiredChecks: [
      "Read existing related files before editing.",
      "Identify integration points and affected modules.",
      "Backup files before destructive changes.",
      "Apply minimal deterministic changes.",
      "Run typecheck after changes.",
      "Run tests if test script exists.",
      "Check git diff before final response.",
      "Record important decisions in agent memory/log."
    ]
  };

  return {
    content: [{ type: "text" as const, text: JSON.stringify(checklist, null, 2) }]
  };
}