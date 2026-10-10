import { describe, expect, it } from "vitest";

import { createHeadpress, memoryCartToken } from "../src/index.js";
import { fixtures, json, mockHeadpress } from "../src/testing/index.js";

describe("mockHeadpress", () => {
  it("routes by method and path with params, and answers rest_no_route otherwise", async () => {
    const server = mockHeadpress({
      "GET /headpress/v1/store/config": () => json(fixtures.storeConfig()),
      "GET /wc/store/v1/products/:id": (_request, params) => json(fixtures.storeProduct({ id: Number(params.id) })),
      "POST /wc/store/v1/cart/add-item": () => json(fixtures.storeCart(), { headers: { "Cart-Token": "t" } }),
      "GET /wc/store/v1/cart": () => json(fixtures.storeCart(), { headers: { "Cart-Token": "t" } }),
    });
    const hp = createHeadpress({ baseUrl: "https://wp.test", fetch: server.fetch, cartToken: memoryCartToken() });

    expect((await hp.config.get()).store.name).toBe("Test Store");
    expect((await hp.catalog.get(77))?.id).toBe(77);
    expect((await hp.cart.addItem({ id: 12 })).itemsCount).toBe(1);
    await expect(hp.request("/store/nope")).rejects.toMatchObject({ code: "rest_no_route" });
    expect(server.calls.map((call) => call.method)).toEqual(["GET", "GET", "GET", "POST", "GET"]);
  });
});
