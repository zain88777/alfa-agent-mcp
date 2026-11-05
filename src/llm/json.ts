export function extractJson(text: string): unknown {
  const clean = text.trim();

  try {
    return JSON.parse(clean);
  } catch {}

  const match = clean.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error("No JSON object found in LLM response");
  }

  return JSON.parse(match[0]);
}
