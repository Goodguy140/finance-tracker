import { Prisma } from "@prisma/client";
import { ZodError } from "zod";

export const GENERIC_ACTION_ERROR = "Something went wrong. Please try again.";

function isPrismaError(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError ||
    err instanceof Prisma.PrismaClientUnknownRequestError ||
    err instanceof Prisma.PrismaClientValidationError ||
    err instanceof Prisma.PrismaClientInitializationError ||
    err instanceof Prisma.PrismaClientRustPanicError
  );
}

/** Zod issues into one sentence a person can act on, naming the field when there is one. */
function describeZodError(err: ZodError): string {
  const issue = err.issues[0];
  if (!issue) return "Some of the values you entered are not valid.";
  const field = issue.path.filter((segment) => typeof segment === "string").join(".");
  return field ? `${field}: ${issue.message}` : issue.message;
}

/**
 * True for errors whose message was written for the person submitting the form: our own
 * `throw new Error("…")` guards and validation failures. Database and other unexpected
 * errors are not — their messages describe internals and go to the server log instead.
 */
export function isExpectedActionError(err: unknown): boolean {
  if (err instanceof ZodError) return true;
  if (!(err instanceof Error)) return false;
  if (isPrismaError(err)) return false;
  return Boolean(err.message);
}

export function describeActionError(err: unknown): string {
  if (err instanceof ZodError) return describeZodError(err);
  if (isExpectedActionError(err)) return (err as Error).message;
  return GENERIC_ACTION_ERROR;
}
