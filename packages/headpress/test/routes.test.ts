import { describe, expect, it } from "vitest";

import { createHeadpress, expandRoute, matchRoute, matchRoutes, routeSpecificity } from "../src/index.js";
import { BASE, storeConfig } from "./helpers.js";

describe("expandRoute", () => {
  it("fills tokens in the path and the query", () => {
    expect(expandRoute("/produto/{slug}", { slug: "anel-c152" })).toBe("/produto/anel-c152");
    expect(
      expandRoute("/checkout/order-received?order_id={order_id}&key={order_key}", {
        order_id: 42,
        order_key: "wc_order_abc",
      }),
    ).toBe("/checkout/order-received?order_id=42&key=wc_order_abc");
  });

  it("gives up when a token is missing, like Route_Map::expand()", () => {
    expect(expandRoute("/produto/{slug}", {})).toBeNull();
    expect(expandRoute("/produto/{slug}", { slug: "" })).toBeNull();
    expect(expandRoute("/a?k={key}&l={login}", { key: "x" })).toBeNull();
  });

  it("keeps slashes in {path} only and does not double-encode WordPress slugs", () => {
    expect(expandRoute("/{path}", { path: "sobre/equipe" })).toBe("/sobre/equipe");
    expect(expandRoute("/tags/{slug}", { slug: "a/b" })).toBe("/tags/a%2Fb");
    expect(expandRoute("/produto/{slug}", { slug: "an%c3%a9is" })).toBe("/produto/an%c3%a9is");
    expect(expandRoute("/produto/{slug}", { slug: "anéis" })).toBe("/produto/an%C3%A9is");
    expect(expandRoute("/r?login={login}", { login: "a&b=c" })).toBe("/r?login=a%26b%3Dc");
  });
});

describe("matchRoute", () => {
  const routes = storeConfig().routes;

  it("orders by specificity: a category beats a page on the same path", () => {
    expect(routeSpecificity("/{slug}")).toBeGreaterThan(routeSpecificity("/{path}"));
    expect(matchRoute(routes, "/aneis")).toEqual({ key: "product_cat", tokens: { slug: "aneis" } });
    expect(matchRoutes(routes, "/aneis").map((m) => m.key)).toEqual(["product_cat", "page"]);
  });

  it("matches with the query, trailing slashes and encoded tokens", () => {
    expect(matchRoute(routes, "/produto/an%C3%A9is/?ref=x")).toEqual({ key: "product", tokens: { slug: "anéis" } });
    expect(matchRoute(routes, "https://loja.test/loja")?.key).toBe("shop");
    expect(matchRoute(routes, "/")?.key).toBe("home");
    expect(matchRoute(routes, "/sobre/equipe")).toEqual({ key: "page", tokens: { path: "sobre/equipe" } });
  });
});

describe("client routes", () => {
  it("answers null for routes the store turned off and builds absolute URLs", () => {
    const hp = createHeadpress({ baseUrl: BASE, config: { initial: storeConfig() } });
    expect(hp.routes.has("cart")).toBe(false);
    expect(hp.routes.path("cart")).toBeNull();
    expect(hp.routes.path("product", { slug: "x" })).toBe("/produto/x");
    expect(hp.routes.url("product", { slug: "x" })).toBe("https://loja.test/produto/x");
  });

  it("is empty until the config loads", () => {
    const hp = createHeadpress({ baseUrl: BASE });
    expect(hp.routes.map()).toEqual({});
    expect(hp.routes.path("home")).toBeNull();
  });
});

describe("query tokens", () => {
  it("reads tokens of the pattern's query from the path's query", () => {
    expect(matchRoute(storeConfig().routes, "/checkout/order-received?order_id=42&key=wc_order_x")).toEqual({
      key: "order_received",
      tokens: { order_id: "42", order_key: "wc_order_x" },
    });
  });
});
