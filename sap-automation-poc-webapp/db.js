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
  return await db.collection(OBJECTS_COLLECTION).find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).toArray();
}

async function saveAllObjects(objects) {
  const ids = objects.map((o) => o.id);
  // Delete objects no longer in the list
  if (ids.length > 0) {
    await db.collection(OBJECTS_COLLECTION).deleteMany({ id: { $nin: ids } });
  } else {
    await db.collection(OBJECTS_COLLECTION).deleteMany({});
  }
  // Upsert remaining objects (remove _id to avoid immutable field error)
  for (const obj of objects) {
    obj.updatedAt = new Date();
    const { _id, ...objWithoutId } = obj;
    await db.collection(OBJECTS_COLLECTION).replaceOne(
      { id: obj.id },
      objWithoutId,
      { upsert: true }
    );
  }
}

async function deleteAllObjects() {
  await db.collection(OBJECTS_COLLECTION).deleteMany({});
}

// --- Test Cases ---
async function loadTestCases() {
  return await db.collection(TESTCASES_COLLECTION).find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).toArray();
}

async function saveAllTestCases(testCases) {
  const ids = testCases.map((t) => t.id);
  // Delete test cases no longer in the list
  if (ids.length > 0) {
    await db.collection(TESTCASES_COLLECTION).deleteMany({ id: { $nin: ids } });
  } else {
    await db.collection(TESTCASES_COLLECTION).deleteMany({});
  }
  // Upsert remaining test cases (remove _id to avoid immutable field error)
  for (const tc of testCases) {
    tc.updatedAt = new Date();
    const { _id, ...tcWithoutId } = tc;
    await db.collection(TESTCASES_COLLECTION).replaceOne(
      { id: tc.id },
      tcWithoutId,
      { upsert: true }
    );
  }
}

async function deleteAllTestCases() {
  await db.collection(TESTCASES_COLLECTION).deleteMany({});
}

// --- Test Suites ---
async function loadTestSuites() {
  return await db.collection(TESTSUITES_COLLECTION).find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).toArray();
}

async function saveAllTestSuites(testSuites) {
  const ids = testSuites.map((s) => s.id);
  // Delete test suites no longer in the list
  if (ids.length > 0) {
    await db.collection(TESTSUITES_COLLECTION).deleteMany({ id: { $nin: ids } });
  } else {
    await db.collection(TESTSUITES_COLLECTION).deleteMany({});
  }
  // Upsert remaining test suites (remove _id to avoid immutable field error)
  for (const suite of testSuites) {
    suite.updatedAt = new Date();
    const { _id, ...suiteWithoutId } = suite;
    await db.collection(TESTSUITES_COLLECTION).replaceOne(
      { id: suite.id },
      suiteWithoutId,
      { upsert: true }
    );
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