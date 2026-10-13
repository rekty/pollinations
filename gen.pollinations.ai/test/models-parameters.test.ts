import { SELF } from "cloudflare:test";
import { test } from "@shared/test/fixtures/index.ts";
import { expect } from "vitest";

async function fetchWorker(path: string, init: RequestInit = {}) {
    return SELF.fetch(new Request(`https://gen.pollinations.ai${path}`, init));
}

// Quest #14599: model listings expose supported_parameters and
// default_parameters backed by the model registry. Only controls the
// gateway actually applies may be listed; reasoning models must NOT list
// sampling controls that are stripped (top_p / penalties).

test("chat models advertise supported and default parameters", async () => {
    const response = await fetchWorker("/text/models");
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>[];
    const byName = new Map(
        body.map((model) => [model.name as string, model]),
    );

    // openai (GPT-5.4 Nano): standard sampling family.
    const openai = byName.get("openai");
    expect(openai).toBeDefined();
    expect(openai).toMatchObject({
        supported_parameters: expect.arrayContaining([
            "temperature",
            "top_p",
            "max_tokens",
            "seed",
        ]),
        default_parameters: {
            seed: 0,
            json: false,
            stream: false,
        },
    });

    // gpt-5.4: reasoning family forces temperature=1 and strips sampling
    // controls, so top_p / penalties must not be advertised.
    const gpt54 = byName.get("gpt-5.4");
    expect(gpt54).toBeDefined();
    expect(gpt54).toMatchObject({
        supported_parameters: expect.arrayContaining([
            "temperature",
            "reasoning_effort",
            "max_tokens",
        ]),
        default_parameters: expect.objectContaining({
            temperature: 1,
        }),
    });
    const gpt54Supported = gpt54.supported_parameters as string[];
    expect(gpt54Supported).not.toContain("top_p");
    expect(gpt54Supported).not.toContain("presence_penalty");
    expect(gpt54Supported).not.toContain("frequency_penalty");

    // gemini: search-capable multimodal model through OpenRouter.
    const gemini = byName.get("gemini");
    expect(gemini).toBeDefined();
    expect(gemini).toMatchObject({
        supported_parameters: expect.arrayContaining([
            "temperature",
            "top_p",
            "max_tokens",
            "seed",
        ]),
        default_parameters: {
            seed: 0,
            json: false,
            stream: false,
        },
    });
});

test("/v1/models OpenAI-compatible listing carries the same fields", async () => {
    const response = await fetchWorker("/v1/models");
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: Record<string, unknown>[] };
    const openai = body.data.find((m) => m.id === "openai");
    expect(openai).toBeDefined();
    expect(openai).toMatchObject({
        supported_parameters: expect.arrayContaining(["temperature", "seed"]),
        default_parameters: expect.objectContaining({ seed: 0 }),
    });
});

test("individual model lookup exposes parameters consistently", async () => {
    const listResponse = await fetchWorker("/text/models");
    const list = (await listResponse.json()) as Record<string, unknown>[];
    const listed = list.find((m) => m.name === "gpt-5.4");

    const retrieveResponse = await fetchWorker("/v1/models/gpt-5.4");
    expect(retrieveResponse.status).toBe(200);
    const retrieved = (await retrieveResponse.json()) as Record<
        string,
        unknown
    >;

    expect(retrieved.supported_parameters).toEqual(
        listed?.supported_parameters,
    );
    expect(retrieved.default_parameters).toEqual(listed?.default_parameters);
});