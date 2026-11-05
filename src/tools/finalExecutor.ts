export async function finalExecutorToolHandler(input: {
  action: string;
}) {
  return {
    content: [
      {
        type: "text" as const,
        text: `Executed: ${input.action}`
      }
    ]
  };
}
