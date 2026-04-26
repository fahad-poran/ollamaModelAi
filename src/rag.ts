// src/rag.ts
// ──────────────────────────────────────────────────────────────
//  OPTIMIZED RAG (Retrieval-Augmented Generation) pipeline for HR & Inventory
//  - Faster loading with TOP limits
//  - Error isolation (one table timeout won't break everything)
//  - Attendance limited to last 7 days only
// ──────────────────────────────────────────────────────────────

import "dotenv/config";
import { ChatOllama } from "@langchain/ollama";
import { OllamaEmbeddings } from "@langchain/ollama";
import { MemoryVectorStore } from "langchain/vectorstores/memory";
import { createRetrievalChain } from "langchain/chains/retrieval";
import { createStuffDocumentsChain } from "langchain/chains/combine_documents";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { Document } from "@langchain/core/documents";
import { query, closePool } from "./db";
import * as readline from "readline";

// ── Configuration ─────────────────────────────────────────────
const MAX_EMPLOYEES = 100;
const MAX_PRODUCTS = 100;
const MAX_ATTENDANCE_DAYS = 7;  // Only last 7 days
const MAX_LEAVE_REQUESTS = 100;

// ── 1. LLM for generating answers ────────────────────────────

const llm = new ChatOllama({
  model: process.env.OLLAMA_MODEL ?? "llama3.2",
  baseUrl: process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434",
  temperature: 0.2,
});

// ── 2. Embedding model (converts text → vectors) ─────────────

const embeddings = new OllamaEmbeddings({
  model: process.env.OLLAMA_EMBED_MODEL ?? "nomic-embed-text",
  baseUrl: process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434",
});

// ── 3. Load documents from MSSQL (HR + Inventory) ────────────

async function loadEmployeesFromDB(): Promise<Document[]> {
  console.log("Loading employees from database...");

  const rows = await query(`
    SELECT TOP ${MAX_EMPLOYEES}
      HrEmployeeId,
      FullName,
      NameBangla,
      WorkMobile,
      DeparmentId,
      DesignationId,
      JoiningDate,
      IsActive,
      GenderId,
      ReligionId,
      DateOfBirth,
      MaritialStatus
    FROM HrEmployee
    WHERE IsActive = 1
    ORDER BY HrEmployeeId
  `);

  const docs: Document[] = rows.map((row) => {
    return new Document({
      pageContent: `
        Employee ID: ${row.HrEmployeeId}
        Name: ${row.FullName} ${row.NameBangla ? `(${row.NameBangla})` : ''}
        Department ID: ${row.DeparmentId || 'N/A'}
        Designation ID: ${row.DesignationId || 'N/A'}
        Mobile: ${row.WorkMobile || 'N/A'}
        Joined: ${row.JoiningDate ? new Date(row.JoiningDate).toLocaleDateString() : 'N/A'}
        Status: ${row.IsActive === 1 ? 'Active' : 'Inactive'}
        Gender: ${row.GenderId || 'N/A'}
        Date of Birth: ${row.DateOfBirth ? new Date(row.DateOfBirth).toLocaleDateString() : 'N/A'}
        Marital Status: ${row.MaritialStatus || 'N/A'}
      `.trim(),
      metadata: {
        type: 'employee',
        id: row.HrEmployeeId,
        name: row.FullName,
        departmentId: row.DeparmentId,
        isActive: row.IsActive,
      },
    });
  });

  console.log(`Loaded ${docs.length} employee documents.`);
  return docs;
}

async function loadInventoryFromDB(): Promise<Document[]> {
  console.log("Loading inventory products from database...");

  const rows = await query(`
    SELECT TOP ${MAX_PRODUCTS}
      ProductId,
      ProductName,
      ProductCode,
      DefaultPrice,
      ProductCategoryId,
      CreatedDate,
      UnitId
    FROM invProduct
    WHERE IsActive = 1
    ORDER BY ProductName
  `);

  const docs: Document[] = rows.map((row) => {
    return new Document({
      pageContent: `
        Product ID: ${row.ProductId}
        Product Name: ${row.ProductName}
        Product Code: ${row.ProductCode || 'N/A'}
        Price: ${row.DefaultPrice ? `BDT ${row.DefaultPrice}` : 'N/A'}
        Category ID: ${row.ProductCategoryId || 'N/A'}
        Created: ${row.CreatedDate ? new Date(row.CreatedDate).toLocaleDateString() : 'N/A'}
        Unit ID: ${row.UnitId || 'N/A'}
      `.trim(),
      metadata: {
        type: 'product',
        id: row.ProductId,
        name: row.ProductName,
        price: row.DefaultPrice,
      },
    });
  });

  console.log(`Loaded ${docs.length} product documents.`);
  return docs;
}

async function loadAttendanceFromDB(): Promise<Document[]> {
  console.log(`Loading recent attendance records (last ${MAX_ATTENDANCE_DAYS} days)...`);

  try {
    const rows = await query(`
      SELECT TOP 100
        a.[AttendanceRegId],
        a.employee_id,
        a.inTime_date,
        a.in_time,
        a.out_time,
        a.flag_type,
        e.FullName
      FROM employee_attendance_register_t a
      JOIN HrEmployee e ON a.employee_id = e.HrEmployeeId
      WHERE a.inTime_date >= DATEADD(day, -${MAX_ATTENDANCE_DAYS}, GETDATE())
      ORDER BY a.inTime_date DESC
    `);

    const docs: Document[] = rows.map((row) => {
      return new Document({
        pageContent: `
          Employee: ${row.FullName} (ID: ${row.employee_id})
          Date: ${row.inTime_date ? new Date(row.inTime_date).toLocaleDateString() : 'N/A'}
          In Time: ${row.in_time || 'N/A'}
          Out Time: ${row.out_time || 'N/A'}
          Status: ${row.flag_type || 'N/A'}
        `.trim(),
        metadata: {
          type: 'attendance',
          employeeId: row.employee_id,
          employeeName: row.FullName,
          date: row.inTime_date,
        },
      });
    });

    console.log(`Loaded ${docs.length} recent attendance records.`);
    return docs;
  } catch (err) {
    console.warn(`⚠️  Attendance table query failed (timeout or missing data): ${(err as Error).message}`);
    return []; // Return empty array instead of failing
  }
}

async function loadLeaveRequestsFromDB(): Promise<Document[]> {
  console.log("Loading leave requests...");

  const rows = await query(`
    SELECT TOP ${MAX_LEAVE_REQUESTS}
      l.LeaveId,
      l.IdCardNo,
      l.LeaveFromDate,
      l.LeaveToDate,
      l.LeaveType,
      l.RequestDate,
      l.Reasons,
      l.LeaveBalance,
      l.remainingLeaveDay,
      l.ApproveLeaveCode,
      e.FullName
    FROM EmployeeLeaveRequest l
    JOIN HrEmployee e ON l.IdCardNo = e.IdCardNo
    ORDER BY l.RequestDate DESC
  `);

  const docs: Document[] = rows.map((row) => {
    const leaveTypeMap: Record<number, string> = {
      1: "Sick Leave",
      2: "Annual Leave", 
      3: "Casual Leave",
      4: "Emergency Leave",
    };
    const leaveTypeText = leaveTypeMap[row.LeaveType as number] || `Type ${row.LeaveType}`;

    return new Document({
      pageContent: `
        Employee: ${row.FullName} (ID Card: ${row.IdCardNo})
        Leave From: ${row.LeaveFromDate ? new Date(row.LeaveFromDate).toLocaleDateString() : 'N/A'}
        Leave To: ${row.LeaveToDate ? new Date(row.LeaveToDate).toLocaleDateString() : 'N/A'}
        Leave Type: ${leaveTypeText}
        Requested: ${row.RequestDate ? new Date(row.RequestDate).toLocaleDateString() : 'N/A'}
        Reason: ${row.Reasons || 'N/A'}
        Leave Balance: ${row.LeaveBalance ?? 'N/A'} days
        Remaining Leave: ${row.remainingLeaveDay ?? 'N/A'} days
        Approval Code: ${row.ApproveLeaveCode || 'Not approved yet'}
      `.trim(),
      metadata: {
        type: 'leave',
        leaveId: row.LeaveId,
        employeeName: row.FullName,
        employeeIdCard: row.IdCardNo,
        leaveType: leaveTypeText,
        approveLeaveCode: row.ApproveLeaveCode,
      },
    });
  });

  console.log(`Loaded ${docs.length} leave requests.`);
  return docs;
}

// ── 4. Load ALL documents with error isolation ───────────────

async function loadAllDocuments(): Promise<Document[]> {
  console.log("\n📚 Loading documents from MSSQL database...\n");
  
  // Use Promise.allSettled so one failure doesn't stop others
  const results = await Promise.allSettled([
    loadEmployeesFromDB(),
    loadInventoryFromDB(),
    loadAttendanceFromDB(),
    loadLeaveRequestsFromDB(),
  ]);

  const allDocs: Document[] = [];
  const tableNames = ['Employees', 'Inventory', 'Attendance', 'Leave Requests'];
  
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      allDocs.push(...result.value);
    } else {
      console.warn(`⚠️  Failed to load ${tableNames[index]}: ${result.reason?.message || 'Unknown error'}`);
    }
  });

  console.log(`\n✅ Total documents loaded: ${allDocs.length}\n`);
  
  if (allDocs.length === 0) {
    throw new Error("No documents could be loaded from any table");
  }
  
  return allDocs;
}

// ── 5. Build the RAG chain ────────────────────────────────────

async function buildRagChain() {
  const docs = await loadAllDocuments();

  // Embed all documents and store in memory
  console.log("🔢 Embedding documents with Ollama (this may take a moment)...");
  const vectorStore = await MemoryVectorStore.fromDocuments(docs, embeddings);
  console.log("✅ Embeddings ready.\n");

  // Retriever: on each question, fetch the 5 most relevant documents
  const retriever = vectorStore.asRetriever({ k: 5 });

  // Prompt template: tells the LLM how to use the retrieved context
  const prompt = ChatPromptTemplate.fromMessages([
    [
      "system",
      `You are a helpful HR and Inventory assistant for a company.
      
      You have access to the following data:
      - Employee information (names, departments, contact info)
      - Product inventory (product names, prices)
      - Attendance records (who came when)
      - Leave requests (who requested leave)
      
      Answer the user's question using ONLY the context provided below.
      If the answer is not in the context, say "I don't have that information."
      
      For employee-related questions, provide names and IDs.
      For inventory questions, include product names.
      Be concise and helpful.
      
      Context:
      {context}`,
    ],
    ["human", "{input}"],
  ]);

  // combineDocsChain: takes the retrieved docs + prompt → LLM answer
  const combineDocsChain = await createStuffDocumentsChain({ llm, prompt });

  // Full RAG chain: question → retrieve → combine → answer
  return createRetrievalChain({ retriever, combineDocsChain });
}

// ── 6. Interactive CLI ────────────────────────────────────────

console.log("\n🤖 Building RAG pipeline...\n");

let ragChain;
try {
  ragChain = await buildRagChain();
} catch (err) {
  console.error("❌ Failed to build RAG pipeline:", (err as Error).message);
  process.exit(1);
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

console.log("📚  RAG Assistant ready — answers from your HR & Inventory database\n");
console.log("  Try asking:");
console.log("  → Who are our active employees?");
console.log("  → Show me products");
console.log("  → Any leave requests?");
console.log("  → Tell me about employee attendance");
console.log("  → What products do we have in inventory?");
console.log("  → Find employees who joined recently\n");

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
      console.log("\n🔍 Searching...\n");
      const result = await ragChain.invoke({ input: userInput });

      console.log(`\n💬 Assistant: ${result.answer}`);

      // Show which documents were used as context (useful for debugging)
      if (result.context?.length > 0) {
        const sources = result.context
          .map((d: Document) => {
            if (d.metadata.type === 'employee') return `👤 ${d.metadata.name}`;
            if (d.metadata.type === 'product') return `📦 ${d.metadata.name}`;
            if (d.metadata.type === 'attendance') return `⏰ ${d.metadata.employeeName}`;
            if (d.metadata.type === 'leave') return `📋 ${d.metadata.employeeName}`;
            return `📄 ${d.metadata.type}`;
          })
          .join(", ");
        console.log(`\n  📎 Sources: ${sources}\n`);
      }
      console.log();
    } catch (err: unknown) {
      console.error("❌ RAG error:", (err as Error).message);
    }

    ask();
  });
}

ask();