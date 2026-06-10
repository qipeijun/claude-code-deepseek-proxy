import type { FastifyReply } from "fastify";
import type { ProxyErrorType } from "./types.js";

export class ProxyError extends Error {
  readonly statusCode: number;
  readonly type: ProxyErrorType;

  constructor(statusCode: number, type: ProxyErrorType, message: string) {
    super(message);
    this.name = "ProxyError";
    this.statusCode = statusCode;
    this.type = type;
  }
}

export function toAnthropicError(error: unknown): { statusCode: number; body: unknown } {
  if (error instanceof ProxyError) {
    return {
      statusCode: error.statusCode,
      body: {
        type: "error",
        error: {
          type: error.type,
          message: error.message
        }
      }
    };
  }

  return {
    statusCode: 500,
    body: {
      type: "error",
      error: {
        type: "api_error",
        message: error instanceof Error ? error.message : "Unexpected proxy error"
      }
    }
  };
}

export function sendAnthropicError(reply: FastifyReply, error: unknown): FastifyReply {
  const { statusCode, body } = toAnthropicError(error);
  return reply.status(statusCode).send(body);
}
