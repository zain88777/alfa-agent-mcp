export async function autoOrchestratorToolHandler(input: {
  task: string;
}) {
  return {
    content: [
      {
        type: "text" as const,
        text: `Orchestrating task: ${input.task}`
      }
    ]
  };
}
