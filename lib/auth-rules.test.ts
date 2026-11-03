import { describe, expect, it } from "vitest";
import { isAllowedEmail, parseAllowlist, safeNext } from "./auth-rules";

describe("allowlist", () => {
  it("parses commas, spaces and case", () => {
    expect(parseAllowlist(" A@x.com,b@y.com ; c@z.com\n")).toEqual(new Set(["a@x.com", "b@y.com", "c@z.com"]));
  });

  it("is empty when unset", () => {
    expect(parseAllowlist(undefined).size).toBe(0);
    expect(parseAllowlist("").size).toBe(0);
  });

  it("matches case-insensitively", () => {
    expect(isAllowedEmail("Aaron@Example.com", "aaron@example.com,bro@example.com")).toBe(true);
    expect(isAllowedEmail("bro@example.com", "aaron@example.com,bro@example.com")).toBe(true);
  });

  it("fails closed", () => {
    expect(isAllowedEmail("stranger@example.com", "aaron@example.com")).toBe(false);
    expect(isAllowedEmail("aaron@example.com", "")).toBe(false);
    expect(isAllowedEmail(null, "aaron@example.com")).toBe(false);
    expect(isAllowedEmail("", "")).toBe(false);
  });
});

describe("safeNext", () => {
  it("keeps same-site paths", () => {
    expect(safeNext("/review?intensity=push")).toBe("/review?intensity=push");
  });

  it("drops anything else", () => {
    expect(safeNext("https://evil.example")).toBe("/");
    expect(safeNext("//evil.example")).toBe("/");
    expect(safeNext("/\\evil.example")).toBe("/");
    expect(safeNext(null)).toBe("/");
  });
});
