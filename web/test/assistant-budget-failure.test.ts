import { describe, expect, test } from "bun:test";
import { AgentTurnFailedError, agentAssistantFailureText } from "../src/services/api/agent-assistant";

describe("Assistant confirmed failure separated from disconnection unknown result", () => {
    test("The single-round budget description can be continued by sending new messages instead of using up the lifetime quota.", () => {
        for (const reason of ["turn_request_budget_exhausted", "turn_tool_step_budget_exhausted"]) {
            const text = agentAssistantFailureText(reason);
            expect(text).toContain("Send new message to continue");
            expect(text).toContain("Changes will be retained");
        }
    });
    test("Explicitly use independent error types for failed rounds and preserve stable reasons", () => {
        const error = new AgentTurnFailedError("turn_request_budget_exhausted");
        expect(error).toBeInstanceOf(AgentTurnFailedError);
        expect(error.reason).toBe("turn_request_budget_exhausted");
        expect(error.message).toContain("Call limit");
        expect(error.message).not.toContain("The result is unknown");
    });
    test("Unknown supplier details do not enter user copy directly", () => {
        expect(agentAssistantFailureText("private-provider-error", "call not completed")).toBe("call not completed");
    });
});
