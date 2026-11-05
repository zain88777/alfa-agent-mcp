export async function codeQualityScoreToolHandler(input?: {
  issues?: number;
} | null) {
  const rawIssues = input && typeof input === "object" ? input.issues : undefined;
  const issues = Number.isFinite(rawIssues) ? Math.max(0, Math.floor(rawIssues as number)) : 0;
  const score = Math.max(0, Math.min(100, 100 - issues * 5));

  return {
    content: [
      {
        type: "text" as const,
        text: `Quality Score: ${score}/100`
      }
    ]
  };
}
