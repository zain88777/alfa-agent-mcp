import type { Request, Response, NextFunction } from "express";

export function sendMcpUnauthorized(res: Response): void {
  console.error("[AlfaDev][mcp] unauthorized request");
  res.status(401).json({
    error: {
      code: "UNAUTHORIZED",
      message: "Missing or invalid bearer token.",
    },
  });
}

export function requireMcpBearerTokenWithToken(token: string | undefined, req: Request, res: Response, next: NextFunction): void {
  if (!token) {
    sendMcpUnauthorized(res);
    return;
  }
  const authHeader = req.header("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    sendMcpUnauthorized(res);
    return;
  }
  const providedToken = authHeader.slice("Bearer ".length).trim();
  if (!providedToken || providedToken !== token) {
    sendMcpUnauthorized(res);
    return;
  }
  next();
}

export function requireMcpBearerTokenWithValidators(
  req: Request,
  res: Response,
  next: NextFunction,
  validators: Array<(token: string) => boolean>
): void {
  const authHeader = req.header("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    sendMcpUnauthorized(res);
    return;
  }
  const providedToken = authHeader.slice("Bearer ".length).trim();
  if (!providedToken) {
    sendMcpUnauthorized(res);
    return;
  }
  if (!validators.some((v) => v(providedToken))) {
    sendMcpUnauthorized(res);
    return;
  }
  next();
}
