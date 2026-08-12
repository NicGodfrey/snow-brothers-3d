import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createTenantContext } from "@enterprise-suite/shared-kernel";
import {
  extractTemplateVariables,
  renderTemplate,
} from "../src/domain/content-asset.js";
import { createMarketingModule } from "../src/infrastructure/container.js";

const manager = createTenantContext("t_content", "user_mgr", ["marketing_manager"]);
const viewer = createTenantContext("t_content", "user_viewer", ["viewer"]);

describe("template engine", () => {
  it("extracts distinct variables", () => {
    assert.deepEqual(
      extractTemplateVariables("Hi {{firstName}}, {{ firstName }} from {{company}}"),
      ["firstName", "company"],
    );
  });

  it("substitutes variables and reports missing ones", () => {
    const result = renderTemplate("Hi {{firstName}} at {{company}}", { firstName: "Ada" });
    assert.equal(result.rendered, "Hi Ada at ");
    assert.deepEqual(result.missingVariables, ["company"]);
  });
});

describe("ContentService workflow", () => {
  function makeAsset(module = createMarketingModule()) {
    const asset = module.services.content.create(manager, {
      title: "Launch email",
      slug: "launch-email",
      kind: "email_template",
      subject: "Hi {{firstName}}",
      body: "The launch is live for {{company}}.",
    });
    return { module, asset };
  }

  it("walks draft -> in_review -> approved and back through revise", () => {
    const { module, asset } = makeAsset();
    const { content } = module.services;
    content.submitForReview(manager, asset.id);
    content.approve(manager, asset.id);
    assert.equal(content.get(manager, asset.id).status, "approved");
    assert.ok(content.get(manager, asset.id).isSendable);

    // Editing approved content forces re-review.
    content.revise(manager, asset.id, { body: "New body {{firstName}}", changeNote: "tone" });
    const revised = content.get(manager, asset.id);
    assert.equal(revised.status, "draft");
    assert.equal(revised.currentRevision, 2);
    assert.ok(!revised.isSendable);
  });

  it("only approver roles may approve or reject", () => {
    const { module, asset } = makeAsset();
    const { content } = module.services;
    content.submitForReview(manager, asset.id);
    assert.throws(() => content.approve(viewer, asset.id), /requires one of roles/);
    assert.throws(() => content.reject(viewer, asset.id, "nope"), /requires one of roles/);
    content.approve(manager, asset.id);
  });

  it("enforces slug uniqueness and email subject presence", () => {
    const { module } = makeAsset();
    const { content } = module.services;
    assert.throws(
      () =>
        content.create(manager, {
          title: "Duplicate",
          slug: "launch-email",
          kind: "email_template",
          subject: "s",
          body: "b",
        }),
      /already exists/,
    );
    assert.throws(
      () =>
        content.create(manager, {
          title: "No subject",
          slug: "no-subject",
          kind: "email_template",
          body: "b",
        }),
      /subject/,
    );
  });

  it("limits sms template length", () => {
    const module = createMarketingModule();
    assert.throws(
      () =>
        module.services.content.create(manager, {
          title: "Long SMS",
          slug: "long-sms",
          kind: "sms_template",
          body: "x".repeat(481),
        }),
      /exceeds 480/,
    );
  });

  it("previews with per-recipient variables", () => {
    const { module, asset } = makeAsset();
    const preview = module.services.content.preview(manager, asset.id, {
      firstName: "Ada",
      company: "Analytical Engines",
    });
    assert.equal(preview.subject, "Hi Ada");
    assert.equal(preview.body, "The launch is live for Analytical Engines.");
    assert.deepEqual(preview.missingVariables, []);
    assert.deepEqual(preview.variables.sort(), ["company", "firstName"]);
  });
});
