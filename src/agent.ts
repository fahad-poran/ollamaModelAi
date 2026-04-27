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
import { AgentExecutor, createToolCallingAgent } from "langchain/agents";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { DynamicTool } from "@langchain/core/tools";
import { query, closePool } from "./db";
import * as readline from "readline";

// ── 1. Connect LangChain to local Ollama ─────────────────────

const llm = new ChatOllama({
  model: process.env.OLLAMA_MODEL ?? "llama3.2",
  baseUrl: process.env.OLLAMA_BASE_URL ?? "http://192.168.0.122:11434",
  temperature: 0,
});

// ── 2. Define tools for MSSQL database ────────────────────────

const tools = [

  // ── Tool A: Safe read-only SQL queries ──
  new DynamicTool({
    name: "query_database",
    description: `Execute a SELECT query on the MSSQL database and return results.
    
Available tables:
- HrEmployee (columns: IdCardNo, FullName, DeparmentId, DesignationId, JoiningDate, IsActive)
- employee_attendance_register_t (columns: employee_id, in_time, out_time, flag_type, officeInTime, OfficeOutTime)
- invProduct (columns: ProductId, ProductName, ProductCode, DefaultPrice)

Important: Always use TOP 10 or TOP 20 in your SELECT queries.
Example: "SELECT TOP 10 IdCardNo, FullName FROM HrEmployee"
Example for specific employee: "SELECT TOP 10 * FROM employee_attendance_register_t WHERE employee_id = '35078'"`,
    
    func: async (sqlQuery: string) => {
      try {
        console.log(`\n🔍 Executing SQL: ${sqlQuery}`);
        const results = await query(sqlQuery);
        
        if (!results || results.length === 0) {
          return "No results found.";
        }
        
        // Return formatted results
        return JSON.stringify(results.slice(0, 10), null, 2);
      } catch (error: any) {
        return `Database error: ${error.message}`;
      }
    },
  }),

  // ── Tool B: List all employees ──
  new DynamicTool({
    name: "list_employees",
    description: "Returns a list of employees. Input can be empty or a department name filter.",
    func: async (filter: string) => {
      try {
        let sqlQuery = `SELECT TOP 20 IdCardNo, FullName, DeparmentId FROM HrEmployee WHERE IsActive = 1`;
        if (filter && filter.trim()) {
          sqlQuery += ` AND FullName LIKE '%${filter.replace(/'/g, "''")}%'`;
        }
        sqlQuery += ` ORDER BY FullName`;
        
        console.log(`\n🔍 Executing: ${sqlQuery}`);
        const rows = await query(sqlQuery);
        
        if (rows.length === 0) return "No employees found.";
        
        // Format nicely for display
        const result = rows.map((r, i) => `${i+1}. ID: ${r.IdCardNo} - ${r.FullName} (Dept: ${r.DeparmentId || 'N/A'})`).join("\n");
        return `Found ${rows.length} employees:\n${result}`;
      } catch (error: any) {
        return `Error: ${error.message}`;
      }
    },
  }),

  // ── Tool C: Check employee attendance ──
  new DynamicTool({
    name: "employee_attendance",
    description: "Get attendance records for an employee. Input: employee ID number (e.g., '35078' or '30978')",
    func: async (employeeId: string) => {
      try {
        const cleanId = employeeId.replace(/'/g, "''");
        console.log(`\n🔍 Fetching attendance for employee: ${cleanId}`);
        
        const rows = await query(`
          SELECT TOP 10 
            employee_id, 
            in_time, 
            out_time, 
            flag_type,
            CONVERT(date, in_time) as attendance_date
          FROM employee_attendance_register_t 
          WHERE employee_id = '${cleanId}' 
          ORDER BY in_time DESC
        `);
        
        if (rows.length === 0) {
          return `No attendance records found for employee ID: ${employeeId}`;
        }
        
        // Format nicely
        const result = rows.map((r, i) => {
          const status = r.flag_type === 'P' ? '✅ Present' : r.flag_type === 'A' ? '❌ Absent' : r.flag_type === 'L' ? '🟡 Late' : r.flag_type;
          const date = r.attendance_date || (r.in_time ? new Date(r.in_time).toLocaleDateString() : 'Unknown');
          return `${i+1}. ${date}: ${status} (In: ${r.in_time || 'N/A'}, Out: ${r.out_time || 'N/A'})`;
        }).join("\n");
        
        return `Attendance records for employee ${employeeId}:\n${result}`;
      } catch (error: any) {
        // Try alternative table structure if first query fails
        try {
          const rowsAlt = await query(`
            SELECT TOP 10 
              employee_id, 
              in_time, 
              out_time, 
              flag_type
            FROM employee_attendance_register_t 
            WHERE employee_id = '${cleanId}' 
            ORDER BY in_time DESC
          `);
          
          if (rowsAlt.length === 0) {
            return `No attendance records found for employee ID: ${employeeId}`;
          }
          
          return JSON.stringify(rowsAlt.slice(0, 10), null, 2);
        } catch (err2) {
          return `Error fetching attendance: ${error.message}`;
        }
      }
    },
  }),

  // ── Tool D: Search for employee by ID or name ──
  new DynamicTool({
    name: "find_employee",
    description: "Find employee by ID or name. Input can be an ID number (like '35078') or name fragment.",
    func: async (searchTerm: string) => {
      try {
        const cleanTerm = searchTerm.replace(/'/g, "''");
        let sqlQuery = `SELECT TOP 10 IdCardNo, FullName, DeparmentId, DesignationId, JoiningDate FROM HrEmployee WHERE IsActive = 1`;
        
        if (/^\d+$/.test(cleanTerm)) {
          // It's a number - search by ID
          sqlQuery += ` AND IdCardNo = '${cleanTerm}'`;
        } else {
          // It's text - search by name
          sqlQuery += ` AND FullName LIKE '%${cleanTerm}%'`;
        }
        
        sqlQuery += ` ORDER BY FullName`;
        
        console.log(`\n🔍 Searching for: ${cleanTerm}`);
        const rows = await query(sqlQuery);
        
        if (rows.length === 0) {
          return `No employee found matching: ${searchTerm}`;
        }
        
        const result = rows.map(r => 
          `ID: ${r.IdCardNo} | Name: ${r.FullName} | Dept: ${r.DeparmentId || 'N/A'} | Joined: ${r.JoiningDate ? new Date(r.JoiningDate).toLocaleDateString() : 'N/A'}`
        ).join("\n");
        
        return `Found ${rows.length} employee(s):\n${result}`;
      } catch (error: any) {
        return `Error: ${error.message}`;
      }
    },
  }),

];

// ── 3. Create the tool calling agent (MODERN APPROACH) ───────

const prompt = ChatPromptTemplate.fromMessages([
  ["system", `You are a helpful HR database assistant with access to a MSSQL database.

You have these tools available:
- query_database: Execute custom SELECT queries (use this for complex queries)
- list_employees: Get a list of all employees
- employee_attendance: Get attendance for a specific employee ID
- find_employee: Search for employee by ID number or name

Instructions:
1. Always use the tools to answer questions - never make up data
2. For "show me employees" → use list_employees
3. For "find employee 35078" → use find_employee with the ID
4. For "attendance for employee X" → use employee_attendance with the ID
5. For complex questions → use query_database with proper SELECT TOP syntax
6. Always format responses in a friendly, readable way

Be conversational and helpful.`],
  ["placeholder", "{chat_history}"],
  ["human", "{input}"],
  ["placeholder", "{agent_scratchpad}"],
]);

// Create the agent with tool calling capability
const agent = await createToolCallingAgent({
  llm,
  tools,
  prompt,
});

const agentExecutor = new AgentExecutor({
  agent,
  tools,
  verbose: true, // Set to true to see what the agent is doing
  maxIterations: 5,
  handleParsingErrors: true,
});

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
console.log("  → Find employee 35078");
console.log("  → Show attendance for employee 35078");
console.log("  → What products are low on stock?");
console.log("  → List all inventory products\n");

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
      console.log("\n🤔 Agent thinking...\n");
      const result = await agentExecutor.invoke({ input: userInput });
      console.log(`\n💬 Agent: ${result.output}\n`);
    } catch (err: unknown) {
      console.error("\n❌ Agent error:", (err as Error).message);
      
      // Fallback: Try direct query for employee IDs
      const match = userInput.match(/\d+/);
      if (match) {
        console.log("\n💡 Trying direct database lookup...\n");
        try {
          const empId = match[0];
          const rows = await query(`
            SELECT IdCardNo, FullName, DeparmentId 
            FROM HrEmployee 
            WHERE IdCardNo = '${empId}'
          `);
          
          if (rows.length > 0) {
            console.log(`✅ Found employee:`);
            console.log(`   ID: ${rows[0].IdCardNo}`);
            console.log(`   Name: ${rows[0].FullName}`);
            console.log(`   Department: ${rows[0].DeparmentId || 'N/A'}`);
          } else {
            console.log(`❌ No employee found with ID: ${empId}`);
          }
        } catch (dbErr) {
          console.error("Database lookup failed:", (dbErr as Error).message);
        }
      }
    }

    ask();
  });
}

ask();