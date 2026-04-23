// src/chat.ts
// ──────────────────────────────────────────────────────────────
//  Minimal test: just send a message to Ollama and print the reply.
//  Use this to confirm Ollama is running before testing the agent.
//
//  Run:  npm run chat
// ──────────────────────────────────────────────────────────────

import "dotenv/config";
import { ChatOllama } from "@langchain/ollama";
import { HumanMessage } from "@langchain/core/messages";

const baseUrl = process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434";
const model = process.env.OLLAMA_MODEL ?? "llama3.2";

console.log(`Testing connection to Ollama model: ${model}`);
console.log(`Checking Ollama server at: ${baseUrl}`);

// Quick reachability check so users see a clear error before the LLM client tries to connect.
try {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);
  await fetch(baseUrl, { method: "GET", signal: controller.signal });
  clearTimeout(timeout);
} catch (err: unknown) {
  console.error("❌  Could not reach Ollama server at:", baseUrl);
  console.error("    Start Ollama in a separate terminal:  ollama serve");
  console.error("    Pull the model if needed:               ollama pull", model);
  console.error("\n    Error details:", (err as Error).message);
  process.exit(1);
}

const llm = new ChatOllama({
  model,
  baseUrl,
});

console.log("Sending test message...\n");

try {
  const response = await llm.invoke([
    new HumanMessage("Say hello in one sentence and confirm you are running locally."),
  ]);

  console.log("✅  Ollama is working!\n");
  console.log("Response:", response.content);
} catch (err: unknown) {
  console.error("❌  Could not reach Ollama via the client.");
  console.error("    Ensure Ollama is running and the model is available.");
  console.error("    Start: ollama serve");
  console.error("    Pull:  ollama pull", model);
  console.error("\n    Error details:", (err as Error).message);
}
