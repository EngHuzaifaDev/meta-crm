import { type Db, MongoClient } from "mongodb";

const uri = process.env.MongoDB_URI as string;
const dbName = process.env.MONGO_DB_NAME as string;

if (!uri) {
  throw new Error("MONGODB_URI is not defined");
}

let clientPromise: Promise<MongoClient> | null = null;
let dbPromise: Promise<Db> | null = null;

export async function connectDb(): Promise<Db> {
  if (dbPromise) return dbPromise; // biome-ignore lint/nursery/noMisusedPromises: checking truthiness of promise ref, not value
  if (!clientPromise) {
    clientPromise = new MongoClient(uri).connect();
  }
  dbPromise = clientPromise.then((c) => c.db(dbName));
  return dbPromise;
}
