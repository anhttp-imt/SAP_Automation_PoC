// Database module — MongoDB only.
require('dotenv').config();

const URI = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const DB_NAME = process.env.DB_NAME || 'sap-automation-poc';
const COLLECTION = process.env.COLLECTION_NAME || 'imt-poc-reports';
const OBJECTS_COLLECTION = 'imt-poc-objects';
const TESTCASES_COLLECTION = 'imt-poc-testcases';
const TESTSUITES_COLLECTION = 'imt-poc-testsuites';

let client;
let db;

async function connect() {
  const { MongoClient } = require('mongodb');
  client = new MongoClient(URI);
  await client.connect({ serverSelectionTimeoutMS: 3000 });
  db = client.db(DB_NAME);
  console.log(`[MongoDB] Connected to ${URI}/${DB_NAME}`);
}

// --- Public API ---
async function loadReports() {
  return await db.collection(COLLECTION).find({}).sort({ createdAt: -1 }).toArray();
}

async function saveReport(report) {
  report.createdAt = new Date();
  report.updatedAt = new Date();
  await db.collection(COLLECTION).insertOne(report);
}

async function deleteReport(id) {
  await db.collection(COLLECTION).deleteOne({ id });
}

async function deleteAllReports() {
  await db.collection(COLLECTION).deleteMany({});
}

// --- Objects (Data Elements) ---
async function loadObjects() {
  return await db.collection(OBJECTS_COLLECTION).find({}).sort({ createdAt: -1 }).toArray();
}

async function saveAllObjects(objects) {
  await db.collection(OBJECTS_COLLECTION).deleteMany({});
  if (objects.length > 0) {
    for (const obj of objects) {
      obj.updatedAt = new Date();
      await db.collection(OBJECTS_COLLECTION).insertOne(obj);
    }
  }
}

async function deleteAllObjects() {
  await db.collection(OBJECTS_COLLECTION).deleteMany({});
}

// --- Test Cases ---
async function loadTestCases() {
  return await db.collection(TESTCASES_COLLECTION).find({}).sort({ createdAt: -1 }).toArray();
}

async function saveAllTestCases(testCases) {
  await db.collection(TESTCASES_COLLECTION).deleteMany({});
  if (testCases.length > 0) {
    for (const tc of testCases) {
      tc.updatedAt = new Date();
      await db.collection(TESTCASES_COLLECTION).insertOne(tc);
    }
  }
}

async function deleteAllTestCases() {
  await db.collection(TESTCASES_COLLECTION).deleteMany({});
}

// --- Test Suites ---
async function loadTestSuites() {
  return await db.collection(TESTSUITES_COLLECTION).find({}).sort({ createdAt: -1 }).toArray();
}

async function saveAllTestSuites(testSuites) {
  await db.collection(TESTSUITES_COLLECTION).deleteMany({});
  if (testSuites.length > 0) {
    for (const suite of testSuites) {
      suite.updatedAt = new Date();
      await db.collection(TESTSUITES_COLLECTION).insertOne(suite);
    }
  }
}

async function deleteAllTestSuites() {
  await db.collection(TESTSUITES_COLLECTION).deleteMany({});
}

async function close() {
  if (client) {
    await client.close();
    console.log('[MongoDB] Connection closed');
  }
}

module.exports = {
  connect,
  loadReports, saveReport, deleteReport, deleteAllReports,
  loadObjects, saveAllObjects, deleteAllObjects,
  loadTestCases, saveAllTestCases, deleteAllTestCases,
  loadTestSuites, saveAllTestSuites, deleteAllTestSuites,
  close
};