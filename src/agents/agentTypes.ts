export type AgentRole =
  | "planner"
  | "coder"
  | "reviewer"
  | "tester"
  | "debugger"
  | "security"
  | "finalizer";

export type AgentMessage = {
  role: AgentRole;
  task: string;
  output?: string;
  error?: string;
};
