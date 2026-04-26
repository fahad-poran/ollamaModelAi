// src/agent.ts
// ──────────────────────────────────────────────────────────────
//  Local AI agent that can:
//    • Query your MSSQL database (read-only)
//    • Look up employee, salary, attendance, inventory data
//
//  Run:  npm start
// ──────────────────────────────────────────────────────────────

import "dotenv/config";
import { ChatOllama } from "@langchain/ollama";
import { createReactAgent, AgentExecutor } from "langchain/agents";
import { pull } from "langchain/hub";
import { PromptTemplate } from "@langchain/core/prompts";
import { DynamicTool } from "@langchain/core/tools";
import { query, closePool } from "./db";
import * as readline from "readline";

// ── 1. Connect LangChain to local Ollama ─────────────────────

const llm = new ChatOllama({
  model: process.env.OLLAMA_MODEL ?? "llama3.2",
  baseUrl: process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434", // Use 127.0.0.1 for IPv4
  temperature: 0,
});

// ── 2. Define tools for MSSQL database ────────────────────────

const tools = [

  // ── Tool A: Safe read-only SQL queries ──
  new DynamicTool({
    name: "query_database",
    description: `
      Run a SELECT query against the MSSQL database.
      
      Available tables:
        - HrEmployee (Employee records)
        - HrEmployeeSalary (Employee salary information)
        - employee_attendance_register_t (Employee attendance records)
        - EmployeeLeaveRequest (Employee leave requests)
        - invProduct (Inventory products)
        - invCsStatus (Inventory status codes)
      
      Common columns (check actual schema with SELECT TOP 1 *):
        HrEmployee: likely IdCardNo, fullName, deparmentId, JoiningDate
        HrEmployeeSalary: likely Idcardno, SalaryYear, SalaryMonth, EmpGrossSalary
        employee_attendance_register_t: likely employee_id, in_time, flag_type,officeInTime,OfficeOutTime,attendancePolicyPK
        EmployeeLeaveRequest: likely IdCardNo, LeaveFrommDate, [LeaveToDate], [RequestDate], [Reasons],[LeaveBalance]
        invProduct: likely ProductId, ProductName, ProductCode,[DefaultPrice]
        invCsStatus: likely CSStatusId, Code, ProductId, UnitId, UnitRate,CreateDate,PurReqCode,ReqQty
      
      Input MUST be a valid T-SQL SELECT statement.
      Use TOP clause for limiting results (e.g., SELECT TOP 10 * FROM table).
      Never use INSERT, UPDATE, DELETE, DROP, or ALTER.
    `,
    func: async (sqlString: string) => {
      const clean = sqlString.trim().toUpperCase();
      if (!clean.startsWith("SELECT")) {
        return "Error: Only SELECT statements are allowed.";
      }
      try {
        const rows = await query(sqlString);
        if (rows.length === 0) return "No results found.";
        return JSON.stringify(rows, null, 2);
      } catch (err: unknown) {
        return `SQL Error: ${(err as Error).message}`;
      }
    },
  }),

  // ── Tool B: List all employees ──
  new DynamicTool({
    name: "list_employees",
    description: "Returns a list of all employees with basic info. Input can be empty string or a department name filter.",
    func: async (filter: string) => {
      let sqlQuery = `SELECT TOP 50 EmployeeID, Name, Department FROM HrEmployee`;
      if (filter && filter.trim()) {
        sqlQuery += ` WHERE Department LIKE '%${filter.replace(/'/g, "''")}%'`;
      }
      sqlQuery += ` ORDER BY Name`;
      const rows = await query(sqlQuery);
      if (rows.length === 0) return "No employees found.";
      return JSON.stringify(rows, null, 2);
    },
  }),

  // ── Tool C: Check employee attendance ──
  new DynamicTool({
    name: "employee_attendance",
    description: "Get attendance records. Input: EmployeeID (e.g., 'EMP001'). Returns recent attendance.",
    func: async (employeeId: string) => {
      const cleanId = employeeId.replace(/'/g, "''");
      const rows = await query(`
        SELECT TOP 20 AttendanceDate, Status 
        FROM EmpAttendanceRegesterT 
        WHERE EmployeeID = '${cleanId}' 
        ORDER BY AttendanceDate DESC
      `);
      if (rows.length === 0) return `No attendance records found for employee ${employeeId}.`;
      return JSON.stringify(rows, null, 2);
    },
  }),

  // ── Tool D: Check low stock inventory ──
  new DynamicTool({
    name: "low_stock_inventory",
    description: "Returns products with stock below threshold. Input: number (e.g., '10'). Defaults to 10.",
    func: async (threshold: string) => {
      const stockThreshold = parseInt(threshold) || 10;
      const rows = await query(`
        SELECT TOP 20 ProductName, Stock, Category 
        FROM invProduct 
        WHERE Stock < ${stockThreshold} 
        ORDER BY Stock
      `);
      if (rows.length === 0) return `No products below stock level ${stockThreshold}.`;
      return JSON.stringify(rows, null, 2);
    },
  }),

];

// ── 3. Create the ReAct agent ─────────────────────────────────

const prompt = await pull<PromptTemplate>("hwchase17/react");
const agent = await createReactAgent({ llm, tools, prompt });
const agentExecutor = new AgentExecutor({ agent, tools });

// ── 4. Interactive CLI loop ───────────────────────────────────

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

console.log("\n🤖  Local AI Agent ready (Ollama + MSSQL)");
console.log("    Database: Your HR & Inventory System");
console.log("    Type a question or 'exit' to quit.\n");

console.log("  Try asking:");
console.log("  → Show me all employees");
console.log("  → Who has taken leave this month?");
console.log("  → What products are low on stock?");
console.log("  → Show attendance for employee EMP001");
console.log("  → List all inventory products");
console.log("  → What's the total stock value?\n");

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

    ask();
  });
}

ask();