// lib/db/connect.ts
import mongoose from "mongoose";

// Use exactly the env variable names you defined
const MONGODB_URI = process.env.MongoDB_URI as string;
const DB_NAME = process.env.MONGO_DB_NAME || "leadtor";

if (!MONGODB_URI) {
  throw new Error(
    "Please define MongoDB_URI in your environment variables. Example: mongodb://root:root@mongodb:27017"
  );
}

// If no database name is present in the URI, append it
const uriWithDB = MONGODB_URI.includes("/", 10) // crude check if db name already present
  ? MONGODB_URI
  : `${MONGODB_URI.replace(/\/+$/, "")}/${DB_NAME}`;

interface MongooseCache {
  conn: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
}

declare global {
  // eslint-disable-next-line no-var
  var mongooseCache: MongooseCache | undefined;
}

const cached: MongooseCache = global.mongooseCache ?? { conn: null, promise: null };

if (!global.mongooseCache) {
  global.mongooseCache = cached;
}

async function dbConnect(): Promise<typeof mongoose> {
  if (cached.conn) return cached.conn;

  if (!cached.promise) {
    cached.promise = mongoose.connect(uriWithDB, {
      bufferCommands: false,
    });
  }

  try {
    cached.conn = await cached.promise;
    console.log(`✅ MongoDB connected: ${uriWithDB}`);
    return cached.conn;
  } catch (error) {
    cached.promise = null; // reset on failure so next attempt can retry
    throw error;
  }
}
const db = await dbConnect();

export async function getNativeDb() {
  if (!db.connection.db) {
    // If for some reason db is missing, force reconnect
    await dbConnect();
  }
  return db.connection.db!;
}



export { db };
export default dbConnect;