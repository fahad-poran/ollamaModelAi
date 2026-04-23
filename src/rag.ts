// src/rag.ts
// ──────────────────────────────────────────────────────────────
//  RAG (Retrieval-Augmented Generation) pipeline.
//
//  How it works:
//    1. Load product descriptions from PostgreSQL
//    2. Embed them with Ollama (nomic-embed-text model)
//    3. Store embeddings in an in-memory vector store
//    4. On each question, find the most relevant products
//    5. Send those products as context to the LLM
//
//  Run:  npm run rag
//
//  For production: swap MemoryVectorStore → PGVectorStore
//  so embeddings persist in PostgreSQL (needs pgvector extension).
// ──────────────────────────────────────────────────────────────

import "dotenv/config";
import { ChatOllama }            from "@langchain/ollama";
import { OllamaEmbeddings }      from "@langchain/ollama";
import { MemoryVectorStore }     from "langchain/vectorstores/memory";
import { createRetrievalChain }  from "langchain/chains/retrieval";
import { createStuffDocumentsChain } from "langchain/chains/combine_documents";
import { ChatPromptTemplate }    from "@langchain/core/prompts";
import { Document }              from "@langchain/core/documents";
import { query, closePool }      from "./db";
import * as readline             from "readline";

// ── 1. LLM for generating answers ────────────────────────────

const llm = new ChatOllama({
  model:       process.env.OLLAMA_MODEL    ?? "llama3.2",
  baseUrl:     process.env.OLLAMA_BASE_URL ?? "http://localhost:11434",
  temperature: 0.2, // slight creativity for natural-sounding answers
});

// ── 2. Embedding model (converts text → vectors) ─────────────
//
//  nomic-embed-text is small, fast, and runs fully locally via Ollama.
//  Pull it first:  ollama pull nomic-embed-text

const embeddings = new OllamaEmbeddings({
  model:   process.env.OLLAMA_EMBED_MODEL ?? "nomic-embed-text",
  baseUrl: process.env.OLLAMA_BASE_URL    ?? "http://localhost:11434",
});

// ── 3. Load documents from PostgreSQL ────────────────────────

async function loadDocumentsFromDB(): Promise<Document[]> {
  console.log("Loading products from database...");

  // Load products with their stats (avg rating, how many sold)
  const rows = await query(`
    SELECT
      ps.id,
      ps.name,
      ps.category,
      ps.price,
      ps.stock,
      ps.avg_rating,
      ps.review_count,
      ps.total_sold,
      p.description
    FROM shop.product_stats ps
    JOIN shop.products p ON p.id = ps.id
  `);

  // Also load reviews to enrich the document context
  const reviews = await query(`
    SELECT
      r.product_id,
      c.name AS reviewer,
      r.rating,
      r.comment
    FROM shop.reviews r
    JOIN shop.customers c ON c.id = r.customer_id
  `);

  // Group reviews by product_id for easy lookup
  const reviewMap: Record<number, string[]> = {};
  for (const r of reviews) {
    const pid = r.product_id as number;
    if (!reviewMap[pid]) reviewMap[pid] = [];
    reviewMap[pid].push(`${r.reviewer} (${r.rating}★): ${r.comment}`);
  }

  // Convert each row into a LangChain Document
  // The pageContent is what gets embedded — make it descriptive!
  const docs: Document[] = rows.map((row) => {
    const productReviews = reviewMap[row.id as number]?.join(". ") ?? "No reviews yet.";

    return new Document({
      pageContent: `
        Product: ${row.name}
        Category: ${row.category}
        Price: ${row.price} BDT
        Stock: ${row.stock} units remaining
        Average rating: ${row.avg_rating} out of 5 (${row.review_count} reviews)
        Total units sold: ${row.total_sold}
        Description: ${row.description}
        Customer reviews: ${productReviews}
      `.trim(),
      metadata: {
        product_id: row.id,
        name:       row.name,
        category:   row.category,
        price:      row.price,
      },
    });
  });

  console.log(`Loaded ${docs.length} product documents.\n`);
  return docs;
}

// ── 4. Build the RAG chain ────────────────────────────────────

async function buildRagChain() {
  const docs = await loadDocumentsFromDB();

  // Embed all documents and store in memory
  console.log("Embedding documents with Ollama (this may take a moment)...");
  const vectorStore = await MemoryVectorStore.fromDocuments(docs, embeddings);
  console.log("Embeddings ready.\n");

  // Retriever: on each question, fetch the 3 most relevant products
  const retriever = vectorStore.asRetriever({ k: 3 });

  // Prompt template: tells the LLM how to use the retrieved context
  const prompt = ChatPromptTemplate.fromMessages([
    [
      "system",
      `You are a helpful e-commerce assistant for an online store.
       Answer the user's question using ONLY the product context provided below.
       If the answer is not in the context, say "I don't have that information."
       Be concise and friendly.

       Context (relevant products from our database):
       {context}`,
    ],
    ["human", "{input}"],
  ]);

  // combineDocsChain: takes the retrieved docs + prompt → LLM answer
  const combineDocsChain = await createStuffDocumentsChain({ llm, prompt });

  // Full RAG chain: question → retrieve → combine → answer
  return createRetrievalChain({ retriever, combineDocsChain });
}

// ── 5. Interactive CLI ────────────────────────────────────────

const ragChain = await buildRagChain();

const rl = readline.createInterface({
  input:  process.stdin,
  output: process.stdout,
});

console.log("📚  RAG Assistant ready — answers from your product database\n");
console.log("  Try asking:");
console.log("  → Which product is best for someone who runs every day?");
console.log("  → Do you have anything for home office work?");
console.log("  → What do customers think about the earbuds?");
console.log("  → I want something under 1000 BDT\n");

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
      const result = await ragChain.invoke({ input: userInput });

      console.log(`\nAssistant: ${result.answer}`);

      // Show which products were used as context (useful for debugging)
      if (result.context?.length > 0) {
        const names = result.context
          .map((d: Document) => d.metadata.name)
          .join(", ");
        console.log(`  [Sources: ${names}]\n`);
      }
    } catch (err: unknown) {
      console.error("RAG error:", (err as Error).message);
    }

    ask();
  });
}

ask();
