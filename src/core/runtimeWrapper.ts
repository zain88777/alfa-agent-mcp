import { initSystem } from "./initSystem.js";
import { handleError } from "./errorHandler.js";

export async function runSafe(goal: string) {
  try {
    const { runtime } = initSystem();
    return await runtime.run(goal);
  } catch (e) {
    return handleError(e);
  }
}
