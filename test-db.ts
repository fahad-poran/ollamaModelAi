import { query, closePool } from './src/db.js';

async function test() {
  try {
    console.log("Testing MSSQL connection...");
    
    // Test 1: Check HrEmployee table
    const employees = await query("SELECT TOP 5 * FROM HrEmployee");
    console.log("Employees:", JSON.stringify(employees, null, 2));
    
    // Test 2: Check invProduct table
    const products = await query("SELECT TOP 5 * FROM invProduct");
    console.log("Products:", JSON.stringify(products, null, 2));
    
    await closePool();
  } catch (err) {
    console.error("Test failed:", err);
  }
}

test();