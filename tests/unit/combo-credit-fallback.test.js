import { describe, expect, it, vi } from "vitest";
import { handleComboChat } from "../../open-sse/services/combo.js";

describe("combo credit fallback", () => {
  it.each([
    ["You have insufficient credits to make this request.", true],
    ["Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.", true],
    ["Bad request", false],
  ])("routes a 400 response correctly: %s", async (message, shouldContinue) => {
    const body = { messages: [{ role: "user", content: "Hello" }] };
    const models = ["cmc/deepseek/deepseek-v4-pro", "mistral/mistral-medium-latest"];
    const failureBody = { error: { message } };
    const successBody = { choices: [{ message: { content: "Hello" } }] };
    const failure = Response.json(failureBody, { status: 400 });
    const success = Response.json(successBody);
    const handleSingleModel = vi.fn()
      .mockResolvedValueOnce(failure)
      .mockResolvedValueOnce(success);

    const response = await handleComboChat({
      body, models, handleSingleModel,
      log: { info: vi.fn(), warn: vi.fn() },
      comboName: "credit-fallback", comboStrategy: "fallback",
    });

    // A served response is a clone carrying x-9router-* route headers; compare what it carries.
    expect(response.status).toBe(shouldContinue ? 200 : 400);
    expect(await response.json()).toEqual(shouldContinue ? successBody : failureBody);
    // (body, model) only — non-last members also receive a response-budget arg ({ deadlineAt }).
    expect(handleSingleModel.mock.calls.map((call) => call.slice(0, 2))).toEqual(
      (shouldContinue ? models : models.slice(0, 1)).map((model) => [body, model])
    );
  });
});
