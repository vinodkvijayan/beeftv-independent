import { expect, test } from "bun:test";
import { explainGenerationError } from "../src/lib/generation-error";

test("402 reservation failure points to caller quota only with explicit funding evidence", () => {
 expect(explainGenerationError("The current account limit is insufficient: please check the account balance, or contact the administrator to adjust the limit and try again.").category).toBe("quota_user");
 const body = {error:{code:"video_reservation_failed",message:"insufficient balance for this video request"}};
 const failure = explainGenerationError({status:402,body});
 expect(failure.category).toBe("quota_user");
 expect(failure.message).toContain("Tokens, packages");
 expect(failure.message).not.toContain("supplier");
 expect(explainGenerationError({status:503,body:{error:{code:"video_reservation_failed",message:"video submission is temporarily unavailable"}}}).category).toBe("provider_unavailable");
 expect(explainGenerationError({status:402,body:{error:{message:"insufficient balance"}}}).category).toBe("quota_unknown");
});

test("delivery failure and saved message preserve already generated guidance", () => {
 const failure = explainGenerationError(JSON.stringify({error:{code:"video_delivery_failed",message:"Video generated but could not be saved"}}));
 expect(failure.category).toBe("delivery_failed");
 expect(failure.message).toContain("No need to regenerate");
 expect(failure.blockAutomaticRetry).toBe(true);
 expect(explainGenerationError({ code: failure.category, message: failure.message }).category).toBe("delivery_failed");
});
