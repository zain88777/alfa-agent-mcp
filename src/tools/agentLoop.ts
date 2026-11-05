export async function agentLoopToolHandler(input: {
  goal: string;
}) {
  const loop = [
    "Think",
    "Plan",
    "Act",
    "Check",
    "Repeat"
  ];

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({ goal: input.goal, loop }, null, 2)
      }
    ]
  };
}
