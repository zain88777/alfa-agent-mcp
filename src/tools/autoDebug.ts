export async function autoDebugToolHandler(input: {
  error: string;
}) {
  return {
    content: [
      {
        type: "text" as const,
        text: `Debugging: ${input.error}`
      }
    ]
  };
}
