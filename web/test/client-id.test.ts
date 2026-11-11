import { describe, expect, test } from "bun:test";

import { createClientId } from "../src/lib/client-id";

describe("createClientId", () => {
    test("When randomUUID is missing, a secure random number is still used to create the ID.", () => {
        const descriptor = Object.getOwnPropertyDescriptor(crypto, "randomUUID");
        Object.defineProperty(crypto, "randomUUID", { value: undefined, configurable: true });
        try {
            const ids = new Set(Array.from({ length: 100 }, () => createClientId()));
            expect(ids.size).toBe(100);
        } finally {
            if (descriptor) Object.defineProperty(crypto, "randomUUID", descriptor);
            else delete (crypto as Partial<Crypto>).randomUUID;
        }
    });
    test("Generate a unique client identifier that does not rely on randomUUID", () => {
        const ids = Array.from({ length: 100 }, () => createClientId());

        expect(new Set(ids).size).toBe(ids.length);
        ids.forEach((id) => expect(id).toMatch(/^[A-Za-z0-9_-]{21}$/));
    });
});
