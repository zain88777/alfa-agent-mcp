import { ToolExecutionErrorClass } from "./src/core/errorResponse.js";

const tests = [
  { name: "token", input: 'Auth: token = "test-token-placeholder"' },
  { name: "auth", input: 'authorization: "Bearer eyJhbGciOiJIUzI1NiJ9.xxx"' },
  { name: "privateKey", input: 'privateKey: "test-private-key-placeholder"' },
];

for (const t of tests) {
  const result = ToolExecutionErrorClass.sanitizeMessage(t.input);
  console.log(`${t.name}: ${JSON.stringify(result)} -> REDACTED: ${result.includes("[REDACTED]")}`);
}
