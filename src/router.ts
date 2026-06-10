import { ProxyError } from "./errors.js";
import { resolveProvider } from "./config.js";
import type { AppConfig, MatchedRoute, ResolvedRouteTarget, RouteConfig, RouteTarget } from "./types.js";

export function matchRoute(config: AppConfig, externalModel: string): MatchedRoute {
  const route = selectRoute(config.routes, externalModel);
  if (!route) {
    throw new ProxyError(404, "not_found_error", `No route configured for model "${externalModel}"`);
  }

  return {
    externalModel,
    primary: resolveRouteTarget(config, route),
    fallback: route.fallback.map((target) => resolveRouteTarget(config, target))
  };
}

export function listExternalModels(config: AppConfig): string[] {
  return config.routes.map((route) => route.match.exact ?? `${route.match.prefix}*`);
}

function selectRoute(routes: RouteConfig[], model: string): RouteConfig | undefined {
  const exact = routes.find((route) => route.match.exact === model);
  if (exact) {
    return exact;
  }

  return routes
    .filter((route) => route.match.prefix && model.startsWith(route.match.prefix))
    .sort((left, right) => right.match.prefix!.length - left.match.prefix!.length)[0];
}

function resolveRouteTarget(config: AppConfig, target: RouteTarget): ResolvedRouteTarget {
  return {
    ...target,
    providerConfig: resolveProvider(config, target.provider)
  };
}
