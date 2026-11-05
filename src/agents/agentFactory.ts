import { BaseAgent } from "./baseAgent.js";
import { AgentRole } from "./agentTypes.js";

const prompts: Record<AgentRole, string> = {
  planner: "Break the task into safe, ordered implementation steps.",
  coder: "Implement minimal deterministic code changes.",
  reviewer: "Review code changes for correctness and integration risks.",
  tester: "Decide and run validation strategy using available tools.",
  debugger: "Diagnose errors and propose exact fixes.",
  security: "Check for dangerous commands, secrets, unsafe file access, and risky logic.",
  finalizer: "Summarize completed work, remaining risks, and final status."
};

export function createAgent(role: AgentRole) {
  return new BaseAgent(role, prompts[role]);
}
