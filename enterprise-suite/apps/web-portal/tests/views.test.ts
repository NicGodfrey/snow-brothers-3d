import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classes, escapeHtml, html, join, jsonScript, raw, render } from "../src/http/views/html.js";
import { dataTable, pager } from "../src/http/views/components.js";
import { renderPage } from "../src/http/views/layout.js";
import { moduleListPage } from "../src/http/views/pages/module-list.js";
import { createHarness, USERS } from "./helpers.js";

const harness = createHarness();

describe("html templating", () => {
  it("escapes interpolated values", () => {
    const evil = `<script>alert("x")</script>`;
    assert.equal(
      render(html`<p>${evil}</p>`),
      "<p>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;</p>",
    );
    assert.equal(escapeHtml("a&b'c"), "a&amp;b&#39;c");
  });

  it("passes through nested Html and arrays, drops nullish values", () => {
    const nested = html`<b>${"x"}</b>`;
    assert.equal(render(html`${nested}${[raw("1"), raw("2")]}${null}${undefined}${false}`), "<b>x</b>12");
  });

  it("joins nodes and builds conditional class lists", () => {
    assert.equal(render(join([raw("a"), raw("b")], "-")), "a-b");
    assert.equal(classes(["btn", false, undefined, "btn--x"]), "btn btn--x");
  });

  it("escapes closing tags inside embedded JSON", () => {
    assert.equal(render(jsonScript({ a: "</script>" })), '{"a":"\\u003c/script>"}');
  });
});

describe("components", () => {
  it("renders an empty state instead of an empty table", () => {
    const markup = render(dataTable([], []));
    assert.match(markup, /Nothing to show/);
    assert.ok(!markup.includes("<table"));
  });

  it("renders a pager with the visible range and links", () => {
    const markup = render(
      pager({ path: "/m/sales/quotes", page: 2, pageSize: 10, total: 25, query: "&q=x" }),
    );
    assert.match(markup, /href="\/m\/sales\/quotes\?page=1&amp;q=x"/);
    assert.match(markup, /href="\/m\/sales\/quotes\?page=3&amp;q=x"/);
    assert.match(markup, /11–20 of 25/);
  });

  it("does not link past the last page", () => {
    const markup = render(
      pager({ path: "/m/sales/quotes", page: 3, pageSize: 10, total: 25, query: "" }),
    );
    assert.ok(!markup.includes("page=4"));
  });
});

describe("page rendering", () => {
  it("renders the shell with the rail, tenant switcher and active view", async () => {
    const session = harness.session(USERS.salesManager, "acme");
    const preferences = await harness.container.preferences.load(session);
    const shell = harness.container.navigation.build(session, "/m/sales/quotes", preferences);
    const view = await harness.container
      .forSession(session)
      .modules.loadList(session, "sales", "quotes");

    const markup = render(
      renderPage({
        title: "Sales · Quotes",
        shell,
        counts: { pendingApprovals: 2 },
        content: moduleListPage({ shell, view }),
      }),
    );

    assert.match(markup, /<title>Sales · Quotes · Enterprise Portal<\/title>/);
    assert.match(markup, /class="rail__link rail__link--active"\s+href="\/m\/sales\/quotes"/);
    assert.match(markup, /<span class="rail__count">2<\/span>/);
    assert.match(markup, /Acme Manufacturing/);
    assert.match(markup, /Northwind Traders/);
    assert.match(markup, /Approve discount/);
  });

  it("marks views the session cannot open as disabled", async () => {
    const buyer = harness.session(USERS.buyer, "acme");
    const preferences = await harness.container.preferences.load(buyer);
    const shell = harness.container.navigation.build(buyer, "/", preferences);
    const markup = render(renderPage({ title: "Overview", shell, content: html`<p>ok</p>` }));
    assert.match(markup, /rail__link--disabled/);
    assert.ok(!markup.includes('href="/m/sales/approvals"'));
  });
});
