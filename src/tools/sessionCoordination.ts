import { z } from "zod";
import { globalSessionCoordinator } from "../core/sessionCoordinator.js";

export const sessionCoordinationSchema = z.object({
  action: z.enum(["status"]).default("status"),
}).strict();

export async function sessionCoordinationToolHandler(input: { action?: "status" }) {
  void input;
  return globalSessionCoordinator.getCoordinationReport();
}
