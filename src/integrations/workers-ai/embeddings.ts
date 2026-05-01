import { loadConfig } from "~/config/env";

type EmbeddingResponse = {
  data?: number[][];
  shape?: number[];
  pooling?: "mean" | "cls";
};

export async function embedTexts(env: Env, texts: string[]) {
  if (texts.length === 0) {
    return [];
  }
  const config = loadConfig(env);
  const response = (await env.AI.run(config.workersAiEmbeddingModel, {
    text: texts,
    pooling: "cls",
  })) as EmbeddingResponse;
  if (!response.data || response.data.length !== texts.length) {
    throw new Error("Workers AI embedding response did not return embeddings for all inputs.");
  }
  return response.data;
}

export async function embedText(env: Env, text: string) {
  const [embedding] = await embedTexts(env, [text]);
  return embedding;
}
