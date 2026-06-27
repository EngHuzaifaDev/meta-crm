import { MongoClient, Db } from "mongodb";

const uri = process.env.MongoDB_URI as string;
const dbName = process.env.MONGO_DB_NAME as string;

if (!uri) {
  throw new Error("MONGODB_URI is not defined");
}

let client: MongoClient;
let db: Db;

declare global {
  // eslint-disable-next-line no-var
  var _mongoClient: MongoClient | undefined;
}

if (!global._mongoClient) {
  client = new MongoClient(uri);
  await client.connect();
  global._mongoClient = client;
} else {
  client = global._mongoClient;
}

const mongodbInstance = client.db(dbName);

export { mongodbInstance };