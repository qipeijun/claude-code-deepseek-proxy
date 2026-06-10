import { z } from "zod";

export const contentBlockTypeSchema = z.enum([
  "text",
  "tool_use",
  "tool_result",
  "thinking",
  "image",
  "document",
  "mcp_tool_use",
  "mcp_tool_result"
]);

export type ContentBlockType = z.infer<typeof contentBlockTypeSchema>;

const providerCapabilitiesSchema = z
  .object({
    contentBlocks: z.array(contentBlockTypeSchema).default(["text", "tool_use", "tool_result", "thinking"])
  })
  .default({
    contentBlocks: ["text", "tool_use", "tool_result", "thinking"]
  });

export const providerSchema = z.object({
  type: z.literal("anthropic"),
  baseUrl: z.string().url().optional(),
  baseUrlEnv: z.string().min(1).optional(),
  modelsUrl: z.string().url().optional(),
  apiKey: z.string().min(1).optional(),
  apiKeyEnv: z.string().min(1).optional(),
  timeoutMs: z.number().int().positive().default(120_000),
  capabilities: providerCapabilitiesSchema
}).refine((value) => Boolean(value.baseUrl) !== Boolean(value.baseUrlEnv), {
  message: "provider must contain exactly one of baseUrl or baseUrlEnv"
}).refine((value) => Boolean(value.apiKey) || Boolean(value.apiKeyEnv), {
  message: "provider must contain at least one of apiKey or apiKeyEnv"
});

export const routeTargetSchema = z.object({
  provider: z.string().min(1),
  upstreamModel: z.string().min(1)
});

export const routeSchema = routeTargetSchema.extend({
  match: z
    .object({
      exact: z.string().min(1).optional(),
      prefix: z.string().min(1).optional()
    })
    .refine((value) => Boolean(value.exact) !== Boolean(value.prefix), {
      message: "route.match must contain exactly one of exact or prefix"
    }),
  fallback: z.array(routeTargetSchema).default([])
});

export const appConfigSchema = z.object({
  server: z
    .object({
      host: z.string().min(1).default("127.0.0.1"),
      port: z.number().int().positive().default(8787),
      authToken: z.string().min(1).optional(),
      authTokenEnv: z.string().min(1).optional()
    })
    .default({ host: "127.0.0.1", port: 8787 }),
  providers: z.record(providerSchema),
  routes: z.array(routeSchema).min(1)
});

export type ProviderConfig = z.infer<typeof providerSchema>;
export type RouteTarget = z.infer<typeof routeTargetSchema>;
export type RouteConfig = z.infer<typeof routeSchema>;
export type AppConfig = z.infer<typeof appConfigSchema>;

export type ResolvedProvider = ProviderConfig & {
  name: string;
  baseUrl: string;
  apiKey: string;
};

export type ResolvedRouteTarget = RouteTarget & {
  providerConfig: ResolvedProvider;
};

export type MatchedRoute = {
  externalModel: string;
  primary: ResolvedRouteTarget;
  fallback: ResolvedRouteTarget[];
};

export type ProxyErrorType =
  | "invalid_request_error"
  | "authentication_error"
  | "not_found_error"
  | "overloaded_error"
  | "api_error";
