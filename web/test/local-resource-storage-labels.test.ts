import { describe, expect, test } from "bun:test";

import { resourceStorageLabel, resourceStorageLocation, resourceStorageTitle } from "../src/lib/canvas/resource-storage-status";

describe("local resource storage labels", () => {
    test("describes resource keys as local in local runtime", () => {
        expect(resourceStorageLocation("resource:asset-1", true)).toBe("local");
        expect(resourceStorageLabel("resource:asset-1", true)).toBe("Local");
        expect(resourceStorageTitle("resource:asset-1", true)).toBe("Save in local resource directory");
    });

    test("does not present an empty local key as cloud sync failure", () => {
        expect(resourceStorageLabel("", true)).toBe("not saved");
        expect(resourceStorageTitle("", true)).toBe("No resource identifier available yet");
    });

    test("keeps hosted object-storage labels unchanged", () => {
        expect(resourceStorageLocation("resource:asset-1", false)).toBe("oss");
        expect(resourceStorageLabel("resource:asset-1", false)).toBe("Uploaded");
        expect(resourceStorageTitle("resource:asset-1", false)).toContain("object storage");
    });
});
