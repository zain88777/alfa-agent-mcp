export function routeTask(task: string) {
  if (task.includes("fix")) return "coder";
  if (task.includes("test")) return "tester";
  if (task.includes("security")) return "security";

  return "general";
}
