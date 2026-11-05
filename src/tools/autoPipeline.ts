export async function autoPipelineToolHandler(input: {
  goal: string;
}) {
  const steps = [
    "Analyze project",
    "Scan errors",
    "Plan fix",
    "Apply patch",
    "Run typecheck",
    "Run tests",
    "Review diff"
  ];

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({ goal: input.goal, steps }, null, 2)
      }
    ]
  };
}
