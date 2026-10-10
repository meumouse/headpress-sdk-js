// @vitest-environment happy-dom
import { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { createHeadpress, memoryCartToken, money } from "../src/index.js";
import { HeadpressProvider, useCapability, useCart, useFormatMoney, useStoreConfig } from "../src/react/index.js";
import { storeCart } from "./fixtures.js";
import { BASE, json, mockFetch, storeConfig } from "./helpers.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Shop() {
  const config = useStoreConfig();
  const search = useCapability("search");
  const format = useFormatMoney();
  const [cart] = useCart();
  return (
    <p>
      {config?.store.name ?? "…"}|{search ? "search" : "no-search"}|{format(money(129990, "BRL"))}|{cart.cart?.itemsCount ?? "-"}
    </p>
  );
}

describe("react bindings", () => {
  it("renders on the server from the hydrated config", () => {
    const hp = createHeadpress({ baseUrl: BASE, fetch: mockFetch(() => json(storeCart())).fetch });
    const html = renderToString(
      <HeadpressProvider client={hp} initialConfig={storeConfig()}>
        <Shop />
      </HeadpressProvider>,
    );
    expect(html.replace(/<!-- -->/g, "").replace(/\s/g, " ")).toContain("Loja Teste|search|R$ 1.299,90|-");
  });

  it("loads the cart on mount and keeps following it under StrictMode", async () => {
    const { fetch } = mockFetch(() => json(storeCart()));
    const hp = createHeadpress({ baseUrl: BASE, fetch, cartToken: memoryCartToken("t"), config: { initial: storeConfig() } });
    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <StrictMode>
          <HeadpressProvider client={hp}>
            <Shop />
          </HeadpressProvider>
        </StrictMode>,
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(container.textContent).toContain("|2");

    // A cart change from anywhere re-renders the component.
    await act(async () => {
      await hp.cart.updateItem("abc123", 1);
    });
    expect(container.textContent).toContain("|2");
    root.unmount();
  });
});
