import { afterEach, describe, expect, it, vi } from "vitest";
import { STT_MODEL, transcribe } from "./stt";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("transcribe", () => {
  it("sends the recording with the model and the learner's language", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ text: " ευχαριστώ πολύ " }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const text = await transcribe(new Blob([new Uint8Array([1, 2])], { type: "audio/mp4" }), "el");
    expect(text).toBe("ευχαριστώ πολύ");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/audio/transcriptions");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer sk-test");
    const form = init.body as FormData;
    expect(form.get("model")).toBe(STT_MODEL);
    expect(form.getAll("languages[]")).toEqual(["el"]);
    expect((form.get("file") as File).name).toBe("answer.m4a");
  });

  it("names Chrome's webm recordings, and reports OpenAI's error", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: { message: "bad audio" } }), { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(transcribe(new Blob([new Uint8Array([1])], { type: "audio/webm;codecs=opus" }), "fr")).rejects.toThrow("bad audio");
    const form = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as FormData;
    expect((form.get("file") as File).name).toBe("answer.webm");
  });

  it("refuses without a key", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    await expect(transcribe(new Blob([new Uint8Array([1])]), "fr")).rejects.toThrow("OPENAI_API_KEY");
  });
});
