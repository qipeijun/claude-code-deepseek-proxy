import { ProxyError } from "./errors.js";
import { resolveProvider } from "./config.js";
import type { AppConfig, MatchedRoute, ResolvedRouteTarget, RouteConfig, RouteTarget } from "./types.js";

export function matchRoute(config: AppConfig, externalModel: string): MatchedRoute {
  const route = selectRoute(config.routes, externalModel);
  if (!route) {
    const hint = config.routes.length === 0
      ? "（没有任何路由规则，请通过 admin 页面配置后重启）"
      : "";
    throw new ProxyError(
      404,
      "not_found_error",
      `没有匹配 "${externalModel}" 的路由规则${hint}`
    );
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

  // 取最长匹配的 prefix 路由（reduce 一次遍历，不创建中间数组）
  let best: RouteConfig | undefined;
  let bestLen = 0;
  for (const route of routes) {
    if (route.match.prefix && model.startsWith(route.match.prefix)) {
      if (route.match.prefix.length > bestLen) {
        best = route;
        bestLen = route.match.prefix.length;
      }
    }
  }
  return best;
}

function resolveRouteTarget(config: AppConfig, target: RouteTarget): ResolvedRouteTarget {
  return {
    ...target,
    providerConfig: resolveProvider(config, target.provider)
  };
}
