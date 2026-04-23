// src/agent.ts
// ──────────────────────────────────────────────────────────────
//  Local AI agent that can:
//    • Query your PostgreSQL database (read-only)
//    • Look up product details
//    • Summarise orders for a customer
//
//  Run:  npm start
// ──────────────────────────────────────────────────────────────

import "dotenv/config"; // loads .env automatically
import { ChatOllama }       from "@langchain/ollama";
import { createReactAgent, AgentExecutor } from "langchain/agents";
import { pull }             from "langchain/hub";
import { PromptTemplate }   from "@langchain/core/prompts";
import { DynamicTool }      from "@langchain/core/tools";
import { query, closePool } from "./db";
import * as readline        from "readline";

// ── 1. Connect LangChain to local Ollama ─────────────────────

const llm = new ChatOllama({
  model:       process.env.OLLAMA_MODEL    ?? "llama3.2",
  baseUrl:     process.env.OLLAMA_BASE_URL ?? "http://localhost:11434",
  temperature: 0,   // 0 = more reliable for tool-calling agents
});

// ── 2. Define tools the agent can use ────────────────────────
//
//  Each tool is a function the LLM can choose to call.
//  The "description" tells the model WHEN to use it.

const tools = [

  // ── Tool A: safe read-only SQL queries ──
  new DynamicTool({
    name: "query_database",
    description: `
      Run a SELECT query against the shop PostgreSQL database.
      Schema (all tables live in the 'shop' schema):
        shop.customers  (id, name, email, city, joined_at)
        shop.products   (id, name, category, price, stock, description)
        shop.orders     (id, customer_id, status, total, created_at)
        shop.order_items(id, order_id, product_id, quantity, unit_price)
        shop.reviews    (id, product_id, customer_id, rating, comment, created_at)
      Useful views:
        shop.order_summary  — orders joined with customer info
        shop.product_stats  — products with avg_rating and total_sold
      Input MUST be a valid SQL SELECT statement starting with SELECT.
      Never use INSERT, UPDATE, DELETE, DROP.
    `,
    func: async (sql: string) => {
      // Safety guard — only allow SELECT statements
      const clean = sql.trim().toUpperCase();
      if (!clean.startsWith("SELECT")) {
        return "Error: Only SELECT statements are allowed.";
      }
      try {
        const rows = await query(sql);
        if (rows.length === 0) return "No results found.";
        // Return results as a readable JSON string for the model
        return JSON.stringify(rows, null, 2);
      } catch (err: unknown) {
        // Return the error message so the agent can self-correct its SQL
        return `SQL Error: ${(err as Error).message}`;
      }
    },
  }),

  // ── Tool B: list all product categories ──
  new DynamicTool({
    name: "list_categories",
    description: "Returns a list of all product categories in the store. No input needed — pass an empty string.",
    func: async (_: string) => {
      const rows = await query("SELECT DISTINCT category FROM shop.products ORDER BY category");
      return rows.map((r) => r.category).join(", ");
    },
  }),

  // ── Tool C: get low-stock products ──
  new DynamicTool({
    name: "low_stock_alert",
    description: "Returns products with stock below a threshold. Input: a number (e.g. '20'). Defaults to 20 if empty.",
    func: async (input: string) => {
      const threshold = parseInt(input) || 20;
      const rows = await query(
        `SELECT name, category, stock FROM shop.products WHERE stock < ${threshold} ORDER BY stock`
      );
      if (rows.length === 0) return `No products below stock ${threshold}.`;
      return JSON.stringify(rows, null, 2);
    },
  }),

];

// ── 3. Create the ReAct agent ─────────────────────────────────
//
//  ReAct = Reason + Act.
//  The model thinks step-by-step, calls a tool, reads the result,
//  then thinks again until it has a final answer.

const prompt = await pull<PromptTemplate>("hwchase17/react");
const agent = await createReactAgent({ llm, tools, prompt });
const agentExecutor = new AgentExecutor({ agent, tools });

// ── 4. Interactive CLI loop ───────────────────────────────────

const rl = readline.createInterface({
  input:  process.stdin,
  output: process.stdout,
});

console.log("\n🤖  Local AI Agent ready (Ollama + PostgreSQL)");
console.log("    Type a question or 'exit' to quit.\n");

// Example questions to try:
console.log("  Try asking:");
console.log("  → How many customers do we have?");
console.log("  → Which products have low stock?");
console.log("  → What are the top 3 products by average rating?");
console.log("  → Show me all pending orders.\n");

function ask(): void {
  rl.question("You: ", async (input) => {
    const userInput = input.trim();
    if (!userInput || userInput.toLowerCase() === "exit") {
      console.log("Bye!");
      await closePool();
      rl.close();
      return;
    }

    try {
      console.log("\nAgent thinking...\n");

      const result = await agentExecutor.invoke({ input: userInput });

      console.log(`Agent: ${result.output}\n`);
    } catch (err: unknown) {
      console.error("Agent error:", (err as Error).message);
    }

    ask(); // loop back for next question
  });
}

ask();
